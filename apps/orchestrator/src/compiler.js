/*
 * Firmware compiler runner.
 *
 * Compiles one C translation unit plus the project startup code into a
 * Cortex-M4 ELF with the locked RISK-001 compiler profile.
 *
 * Safety controls (trusted local development mode — see SECURITY.md):
 *   - fixed argument vector, no shell, user content never reaches argv
 *   - source-size limit, wall-clock timeout, output-size limit
 *   - private temporary directory, removed on failure by the caller
 *
 * Not provided here: network, memory, and process-count isolation. Those
 * require the container worker described in docs/INFRASTRUCTURE_REQUIREMENTS.md
 * and are a precondition for any public deployment.
 */
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { armTool, repoRoot } from "../../../scripts/lib/tools.mjs";

export const LIMITS = Object.freeze({
  maxSourceBytes: 64 * 1024,
  compileTimeoutMs: 30_000,
  maxElfBytes: 1024 * 1024,
  maxDiagnosticBytes: 64 * 1024,
});

export const FIRMWARE_DIR = path.join(repoRoot, "simulator", "firmware");

/** The locked compiler profile from RISK-001 R1C, plus warnings and debug info. */
export const COMPILER_FLAGS = Object.freeze([
  "-mcpu=cortex-m4",
  "-mthumb",
  "-mfloat-abi=soft",
  "-O0",
  "-g",
  "-ffreestanding",
  "-fno-builtin",
  "-nostdlib",
  "-nostartfiles",
  "-std=c11",
  "-Wall",
  "-Wextra",
]);

/**
 * Runs a process with a timeout and bounded output capture. Never uses a shell.
 * @returns {Promise<{code: number|null, signal: string|null, stdout: string, stderr: string, timedOut: boolean}>}
 */
export function run(command, args, { cwd, timeoutMs, maxOutputBytes = LIMITS.maxDiagnosticBytes, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current, chunk) =>
      current.length >= maxOutputBytes ? current : (current + chunk).slice(0, maxOutputBytes);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs ?? LIMITS.compileTimeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

/**
 * Parses GCC diagnostics ("file:line:col: severity: message").
 * @returns {{file: string, line: number, column: number, severity: string, message: string}[]}
 */
export function parseDiagnostics(stderr, sourceName = "main.c") {
  const diagnostics = [];
  const pattern = /^(.*?):(\d+):(\d+): (error|warning|note|fatal error): (.*)$/;
  for (const raw of stderr.split(/\r?\n/)) {
    const match = pattern.exec(raw);
    if (!match) {
      continue;
    }
    const file = path.basename(match[1]) === sourceName ? sourceName : path.basename(match[1]);
    diagnostics.push({
      file,
      line: Number(match[2]),
      column: Number(match[3]),
      severity: match[4] === "fatal error" ? "error" : match[4],
      message: match[5],
    });
  }
  return diagnostics;
}

/**
 * Compiles C source into an ELF inside a fresh temporary directory.
 *
 * @param {string} source C source text of main.c
 * @returns {Promise<{ok: boolean, workDir: string, elfPath?: string, mapPath?: string,
 *   diagnostics: object[], log: string, elf?: object, error?: string}>}
 */
export async function compileFirmware(source) {
  if (typeof source !== "string") {
    throw new TypeError("source must be a string");
  }
  const sourceBytes = Buffer.byteLength(source, "utf8");
  if (sourceBytes > LIMITS.maxSourceBytes) {
    return {
      ok: false,
      workDir: null,
      diagnostics: [],
      log: "",
      error: `Source is ${sourceBytes} bytes; the limit is ${LIMITS.maxSourceBytes} bytes.`,
    };
  }

  const workDir = await mkdtemp(path.join(os.tmpdir(), "tm4c-build-"));
  const sourcePath = path.join(workDir, "main.c");
  const elfPath = path.join(workDir, "firmware.elf");
  const mapPath = path.join(workDir, "firmware.map");
  await writeFile(sourcePath, source, "utf8");

  const args = [
    ...COMPILER_FLAGS,
    "-T", path.join(FIRMWARE_DIR, "linker.ld"),
    `-Wl,-Map=${mapPath}`,
    path.join(FIRMWARE_DIR, "startup.s"),
    sourcePath,
    "-lgcc",
    "-o", elfPath,
  ];

  let result;
  try {
    result = await run(armTool("gcc"), args, { cwd: workDir, timeoutMs: LIMITS.compileTimeoutMs });
  } catch (error) {
    return {
      ok: false,
      workDir,
      diagnostics: [],
      log: "",
      error: `Could not start arm-none-eabi-gcc (${error.code ?? error.message}). Run \`npm run setup:tools\`.`,
    };
  }

  const log = (result.stdout + result.stderr).split(workDir + path.sep).join("");
  const diagnostics = parseDiagnostics(result.stderr);

  if (result.timedOut) {
    return { ok: false, workDir, diagnostics, log, error: `Compilation exceeded ${LIMITS.compileTimeoutMs} ms and was stopped.` };
  }
  if (result.code !== 0) {
    return { ok: false, workDir, diagnostics, log, error: "Compilation failed." };
  }

  const { size } = await stat(elfPath);
  if (size > LIMITS.maxElfBytes) {
    return { ok: false, workDir, diagnostics, log, error: `ELF is ${size} bytes; the limit is ${LIMITS.maxElfBytes} bytes.` };
  }

  const elf = await inspectElf(elfPath);
  return { ok: true, workDir, elfPath, mapPath, diagnostics, log, elf };
}

/** Extracts verifiable facts about an ELF with binutils (readelf/nm). */
export async function inspectElf(elfPath) {
  const header = await run(armTool("readelf"), ["-h", elfPath], { timeoutMs: 10_000 });
  const sections = await run(armTool("readelf"), ["-S", "-W", elfPath], { timeoutMs: 10_000 });
  const symbols = await run(armTool("nm"), [elfPath], { timeoutMs: 10_000 });

  const field = (name) => new RegExp(`^\\s*${name}:\\s*(.+)$`, "m").exec(header.stdout)?.[1]?.trim();
  const symbol = (name) => {
    const match = new RegExp(`^([0-9a-fA-F]{8}) \\w ${name}$`, "m").exec(symbols.stdout);
    return match ? Number.parseInt(match[1], 16) : null;
  };
  const sectionList = [];
  for (const line of sections.stdout.split(/\r?\n/)) {
    const match = /\]\s+(\S+)\s+(\S+)\s+([0-9a-f]{8})\s+[0-9a-f]+\s+([0-9a-f]+)/.exec(line);
    // Keep only sections that occupy target memory (PROGBITS/NOBITS); skip
    // debug info, symbol/string tables, and other metadata.
    if (match && (match[2] === "PROGBITS" || match[2] === "NOBITS") && !match[1].startsWith(".debug") && match[1] !== ".comment") {
      sectionList.push({ name: match[1], type: match[2], address: Number.parseInt(match[3], 16), size: Number.parseInt(match[4], 16) });
    }
  }

  return {
    class: field("Class"),
    machine: field("Machine"),
    type: field("Type"),
    entry: Number.parseInt(field("Entry point address") ?? "0", 16),
    sections: sectionList,
    symbols: {
      Reset_Handler: symbol("Reset_Handler"),
      main: symbol("main"),
      _estack: symbol("_estack"),
    },
    bytes: (await readFile(elfPath)).length,
  };
}

/** Removes a build directory created by compileFirmware. */
export async function removeBuild(workDir) {
  if (workDir && path.basename(workDir).startsWith("tm4c-build-")) {
    await rm(workDir, { recursive: true, force: true });
  }
}
