/*
 * Renode execution session.
 *
 * Owns one Renode process running the TM4C123GH6PM platform with the custom
 * peripheral models, drives it through the Monitor on stdin/stdout, and
 * streams the models' structured JSON-lines events.
 *
 * Channels:
 *   - stdin/stdout   Monitor commands; completion is detected with an
 *                    explicit marker line after every command.
 *   - events.jsonl   Authoritative peripheral events (TM4C123EventSink.cs).
 *   - renode.log     Renode's own log, forwarded to the console for display
 *                    only. No simulator state is derived from it.
 *   - CPU state      Exception number and SCB fault registers, read through
 *                    the Monitor after each run step (`cpu-fault` events).
 *
 * Time: virtual time advances only through `emulation RunFor`, so every run
 * is deterministic for the same firmware and the same input schedule.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { renodeBinary, repoRoot } from "../../../scripts/lib/tools.mjs";

export const RENODE_DIR = path.join(repoRoot, "simulator", "renode");

export const PERIPHERAL_SOURCES = Object.freeze([
  path.join(RENODE_DIR, "peripherals", "TM4C123EventSink.cs"),
  path.join(RENODE_DIR, "peripherals", "TM4C123SystemControl.cs"),
  path.join(RENODE_DIR, "peripherals", "TM4C123GPIO.cs"),
  path.join(RENODE_DIR, "peripherals", "TM4C123GeneralPurposeTimer.cs"),
  path.join(RENODE_DIR, "peripherals", "TM4C123UnimplementedPeripheral.cs"),
]);

export const PLATFORM = path.join(RENODE_DIR, "platforms", "tm4c123gh6pm.repl");

/** Approximate instruction rate: 16 MHz PIOSC default clock at ~1 instruction per cycle. */
export const CPU_MIPS = 16;

export const SESSION_LIMITS = Object.freeze({
  startupTimeoutMs: 120_000,
  commandTimeoutMs: 60_000,
  maxVirtualTimeNs: 600n * 1_000_000_000n,
  maxWallTimeMs: 30 * 60_000,
});

const PORTS = "ABCDEF";

/** ARMv7-M fault exceptions by exception number. */
const FAULT_EXCEPTIONS = { 3: "HardFault", 4: "MemManage", 5: "BusFault", 6: "UsageFault" };
const CFSR_BFARVALID = 1 << 15;
const ERROR_PATTERNS = [
  /There was an error executing command/i,
  /^Error\b/im,
  /error CS\d+/i,
  /Could not find/i,
  /No such command/i,
];

function monitorPath(file) {
  const normalized = path.resolve(file).split(path.sep).join("/");
  if (/\s/.test(normalized)) {
    throw new Error(`Renode Monitor paths must not contain whitespace: ${normalized}`);
  }
  return `@${normalized}`;
}

/** Incrementally reads complete lines appended to a file. */
class FileTail {
  #handle;
  #offset = 0;
  #remainder = "";

  constructor(handle) {
    this.#handle = handle;
  }

  async readLines() {
    const { size } = await this.#handle.stat();
    if (size <= this.#offset) {
      return [];
    }
    const buffer = Buffer.alloc(size - this.#offset);
    await this.#handle.read(buffer, 0, buffer.length, this.#offset);
    this.#offset = size;
    const lines = (this.#remainder + buffer.toString("utf8")).split(/\r?\n/);
    this.#remainder = lines.pop();
    return lines.filter((line) => line.trim() !== "");
  }

  async close() {
    await this.#handle.close().catch(() => {});
  }
}

export class MonitorCommandError extends Error {
  constructor(command, output) {
    super(`Renode command failed: ${command}\n${output}`);
    this.command = command;
    this.output = output;
  }
}

export class RenodeSession extends EventEmitter {
  /**
   * Starts Renode, loads the platform and the ELF. The CPU is not started
   * until runFor() is called.
   */
  static async start(elfPath, { mips = CPU_MIPS } = {}) {
    const session = new RenodeSession();
    try {
      await session.#launch(elfPath, mips);
    } catch (error) {
      await session.close();
      throw error;
    }
    return session;
  }

  #process = null;
  #workDir = null;
  #stdoutBuffer = "";
  #pending = null;
  #queue = Promise.resolve();
  #markerCounter = 0;
  #events = null;
  #log = null;
  #closed = false;
  #wallTimer = null;
  #runVirtualNs = 0n;
  #reportedFault = null;

  /** Every peripheral event received so far, in sequence order. */
  events = [];

  /** Virtual time advanced by runFor() calls, in nanoseconds. */
  get virtualTimeNs() {
    return this.#runVirtualNs;
  }

  get closed() {
    return this.#closed;
  }

  async #launch(elfPath, mips) {
    this.#workDir = await mkdtemp(path.join(os.tmpdir(), "tm4c-session-"));
    const eventsPath = path.join(this.#workDir, "events.jsonl");
    const logPath = path.join(this.#workDir, "renode.log");
    await writeFile(eventsPath, "");
    await writeFile(logPath, "");

    this.#process = spawn(renodeBinary(), ["--console", "--disable-gui", "--plain", "--hide-log"], {
      cwd: this.#workDir,
      env: { ...process.env, TM4C_EVENT_LOG: eventsPath },
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#process.stdout.setEncoding("utf8").on("data", (chunk) => this.#onStdout(chunk));
    this.#process.stderr.setEncoding("utf8").on("data", (chunk) => this.emit("stderr", chunk));
    this.#process.stdin.on("error", () => {});
    this.#process.on("error", (error) => this.#fail(error));
    this.#process.on("exit", (code, signal) => {
      this.#fail(new Error(`Renode exited (code ${code}, signal ${signal})`));
      this.emit("exit", { code, signal });
    });

    this.#wallTimer = setTimeout(() => {
      this.emit("limit", { kind: "wall-time", limitMs: SESSION_LIMITS.maxWallTimeMs });
      this.close();
    }, SESSION_LIMITS.maxWallTimeMs);

    this.#events = new FileTail(await open(eventsPath, "r"));
    this.#log = new FileTail(await open(logPath, "r"));

    const timeoutMs = SESSION_LIMITS.startupTimeoutMs;
    await this.command(`logFile ${monitorPath(logPath)}`, { timeoutMs });
    for (const source of PERIPHERAL_SOURCES) {
      await this.command(`include ${monitorPath(source)}`, { timeoutMs });
    }
    await this.command('mach create "tm4c123"', { timeoutMs });
    await this.command(`machine LoadPlatformDescription ${monitorPath(PLATFORM)}`, { timeoutMs });
    // Accesses to unmapped (reserved) addresses raise a precise bus fault in
    // the CPU instead of silently returning 0.
    await this.command("sysbus UnhandledAccessBehaviour ThrowException");
    await this.command(`cpu PerformanceInMips ${Number(mips)}`);
    await this.command(`sysbus LoadELF ${monitorPath(elfPath)}`, { timeoutMs });
    await this.poll();
  }

  #onStdout(chunk) {
    this.#stdoutBuffer += chunk;
    let newline;
    while ((newline = this.#stdoutBuffer.indexOf("\n")) >= 0) {
      const line = this.#stdoutBuffer.slice(0, newline).replace(/\r$/, "");
      this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
      this.#onLine(line);
    }
  }

  #onLine(line) {
    const pending = this.#pending;
    if (!pending) {
      return;
    }
    if (line.trim() === pending.marker) {
      this.#pending = null;
      clearTimeout(pending.timer);
      pending.resolve(pending.lines);
      return;
    }
    pending.lines.push(line);
  }

  #fail(error) {
    if (this.#pending) {
      const { reject, timer } = this.#pending;
      this.#pending = null;
      clearTimeout(timer);
      reject(error);
    }
    if (!this.#closed) {
      this.#closed = true;
      this.#cleanup();
    }
  }

  /**
   * Executes one Monitor command and resolves with its output text.
   * Commands are serialized; each is followed by a marker so completion is
   * detected without relying on prompt text.
   */
  command(text, { timeoutMs = SESSION_LIMITS.commandTimeoutMs } = {}) {
    if (/[\r\n]/.test(text)) {
      throw new Error("Monitor commands must be a single line");
    }
    const execute = async () => {
      if (this.#closed) {
        throw new Error("Renode session is closed");
      }
      const marker = `__tm4c_done_${++this.#markerCounter}__`;
      const lines = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.#pending = null;
          reject(new Error(`Renode command timed out after ${timeoutMs} ms: ${text}`));
        }, timeoutMs);
        this.#pending = { marker, lines: [], resolve, reject, timer };
        this.#process.stdin.write(`${text}\npython "print('${marker}')"\n`);
      });
      // Drop Monitor echo lines ("(machine) command") and keep real output.
      const output = lines
        .filter((line) => !/^\((monitor|tm4c123)\)\s/.test(line.trim()) && line.trim() !== "")
        .join("\n");
      if (ERROR_PATTERNS.some((pattern) => pattern.test(output))) {
        throw new MonitorCommandError(text, output);
      }
      return output;
    };
    const result = this.#queue.then(execute, execute);
    this.#queue = result.catch(() => {});
    return result;
  }

  /** Reads newly appended events and log lines and emits them. */
  async poll() {
    if (!this.#events) {
      return;
    }
    for (const line of await this.#events.readLines()) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        this.emit("protocol-error", line);
        continue;
      }
      this.events.push(event);
      this.emit("event", event);
    }

    // Renode's own warnings are forwarded for display only; no simulator
    // state is derived from them.
    for (const line of await this.#log.readLines()) {
      const match = /\[(WARNING|ERROR)\]\s*(.*)$/.exec(line);
      if (match) {
        this.emit("engine-log", { level: match[1].toLowerCase(), message: match[2] });
      }
    }
  }

  /**
   * Reads the CPU exception state and, on entry into a fault handler,
   * emits one `cpu-fault` event with the ARMv7-M fault status registers.
   */
  async checkFault() {
    // Cheap check first (one command per step); full SCB read only on a fault.
    const xpsr = Number.parseInt(/0x[0-9A-Fa-f]+/.exec(await this.command("cpu CPSR"))?.[0] ?? "NaN", 16);
    if (!FAULT_EXCEPTIONS[xpsr & 0x1ff]) {
      this.#reportedFault = null;
      return null;
    }
    const state = await this.cpuState();
    const name = FAULT_EXCEPTIONS[state.exceptionNumber];
    if (!name) {
      this.#reportedFault = null;
      return null;
    }
    const key = `${state.exceptionNumber}:${state.cfsr}:${state.hfsr}:${state.bfar}`;
    if (this.#reportedFault === key) {
      return null;
    }
    this.#reportedFault = key;
    const hex = (value) => (value === null ? null : `0x${value.toString(16).toUpperCase().padStart(8, "0")}`);
    const event = {
      type: "cpu-fault",
      source: "cpu",
      exception: name,
      exceptionNumber: state.exceptionNumber,
      pc: hex(state.pc),
      cfsr: hex(state.cfsr),
      hfsr: hex(state.hfsr),
      bfar: state.cfsr & CFSR_BFARVALID ? hex(state.bfar) : null,
      afterVirtualTimeNs: this.#runVirtualNs.toString(),
    };
    this.events.push(event);
    this.emit("event", event);
    return event;
  }

  /** Advances virtual time by the given number of nanoseconds (deterministic). */
  async runFor(nanoseconds) {
    const ns = BigInt(nanoseconds);
    if (ns <= 0n) {
      throw new RangeError("runFor needs a positive duration");
    }
    if (this.#runVirtualNs + ns > SESSION_LIMITS.maxVirtualTimeNs) {
      this.emit("limit", { kind: "virtual-time", limitNs: SESSION_LIMITS.maxVirtualTimeNs.toString() });
      throw new Error("Virtual-time limit reached for this session");
    }
    const seconds = (Number(ns) / 1e9).toFixed(9);
    await this.command(`emulation RunFor "${seconds}"`);
    this.#runVirtualNs += ns;
    await this.poll();
    await this.checkFault();
  }

  /** MCU reset: peripherals return to reset state, the CPU restarts from the vector table. */
  async reset() {
    await this.command("machine Reset");
    await this.poll();
  }

  /** Drives (level = true/false) or releases (level = null) an external input on a GPIO pin. */
  async setExternalInput(port, pin, level) {
    const portLetter = String(port).toUpperCase();
    if (portLetter.length !== 1 || !PORTS.includes(portLetter)) {
      throw new RangeError(`Unknown GPIO port: ${port}`);
    }
    const pinNumber = Number(pin);
    if (!Number.isInteger(pinNumber) || pinNumber < 0 || pinNumber > 7) {
      throw new RangeError(`Unknown GPIO pin: ${pin}`);
    }
    const target = `sysbus.gpioPort${portLetter}`;
    if (level === null) {
      await this.command(`${target} ReleaseInput ${pinNumber}`);
    } else {
      await this.command(`${target} DriveInput ${pinNumber} ${level ? "true" : "false"}`);
    }
    await this.poll();
  }

  /** Resolved logical state of a pin as reported by the GPIO model. */
  async pinState(port, pin) {
    const portLetter = String(port).toUpperCase();
    if (portLetter.length !== 1 || !PORTS.includes(portLetter)) {
      throw new RangeError(`Unknown GPIO port: ${port}`);
    }
    return (await this.command(`sysbus.gpioPort${portLetter} PinState ${Number(pin)}`)).trim();
  }

  async readWord(address) {
    const output = await this.command(`sysbus ReadDoubleWord 0x${address.toString(16)}`);
    const match = /0x[0-9A-Fa-f]+/.exec(output);
    return match ? Number.parseInt(match[0], 16) : null;
  }

  /** CPU and fault-status snapshot (System Control Block registers per ARMv7-M). */
  async cpuState() {
    const pcText = await this.command("cpu PC");
    // Renode exposes the Cortex-M xPSR under the name CPSR.
    const xpsrText = await this.command("cpu CPSR");
    const pc = Number.parseInt(/0x[0-9A-Fa-f]+/.exec(pcText)?.[0] ?? "NaN", 16);
    const xpsr = Number.parseInt(/0x[0-9A-Fa-f]+/.exec(xpsrText)?.[0] ?? "NaN", 16);
    return {
      pc,
      xpsr,
      exceptionNumber: Number.isNaN(xpsr) ? null : xpsr & 0x1ff,
      cfsr: await this.readWord(0xe000ed28),
      hfsr: await this.readWord(0xe000ed2c),
      bfar: await this.readWord(0xe000ed38),
    };
  }

  /** Stops Renode and removes the session directory. */
  async close() {
    if (this.#closed) {
      return;
    }
    try {
      if (this.#process && this.#process.exitCode === null) {
        this.#process.stdin.write("quit\n");
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 5_000);
          this.#process.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    } finally {
      this.#closed = true;
      await this.#cleanup();
    }
  }

  async #cleanup() {
    clearTimeout(this.#wallTimer);
    if (this.#process && this.#process.exitCode === null && this.#process.signalCode === null) {
      this.#process.kill("SIGKILL");
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 5_000);
        this.#process.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    await this.#events?.close();
    await this.#log?.close();
    this.#events = null;
    this.#log = null;
    if (this.#workDir) {
      const dir = this.#workDir;
      this.#workDir = null;
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
    }
  }
}
