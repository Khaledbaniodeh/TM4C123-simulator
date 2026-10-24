/*
 * Firmware compiler runner.
 *
 * Compiles one C translation unit plus the project startup code into a
 * Cortex-M4 ELF with the locked RISK-001 compiler profile.
 *
 * Device support: firmware may include the project's original CMSIS-style
 * device header (`#include "TM4C123.h"` or "TM4C123GH6PM.h", from
 * simulator/firmware/include). When it does, the build also links
 * simulator/firmware/system_TM4C123.c, so SystemInit() runs before main()
 * and SystemCoreClock is defined, as in a vendor-tool project.
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
export const DEVICE_INCLUDE_DIR = path.join(FIRMWARE_DIR, "include");
export const SYSTEM_SOURCE = path.join(FIRMWARE_DIR, "system_TM4C123.c");

const DEVICE_HEADER_INCLUDE = /^[ \t]*#[ \t]*include[ \t]*[<"](?:TM4C123|TM4C123GH6PM)\.h[>"]/m;

/** True when the source includes the device header (and therefore needs system_TM4C123.c). */
export function usesDeviceHeader(source) {
  return DEVICE_HEADER_INCLUDE.test(source);
}

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
 * Parses compiler, assembler, and linker diagnostics from GCC's stderr:
 *   main.c:12:5: error: …                       compiler (line and column)
 *   startup.s:7: Error: …                       assembler (line only)
 *   main.c:15:(.text.main+0x8): undefined …     linker, with a line from debug info
 *   main.c:(.text+0x8): undefined …             linker, no line
 *   ld: region `FLASH' overflowed …             linker or driver, no location
 * `line` and `column` are null when the tool gives none: a location is never
 * guessed. Notes stay in order after the diagnostic they belong to. The build
 * directory is removed from messages.
 * @returns {{file: string|null, line: number|null, column: number|null,
 *   severity: "error"|"warning"|"note", message: string, origin: "compiler"|"assembler"|"linker"}[]}
 */
export function parseDiagnostics(stderr, sourceName = "main.c", workDir = null) {
  const diagnostics = [];
  const clean = (text) => (workDir ? text.split(workDir + path.sep).join("").split(`${workDir}/`).join("") : text);
  const fileName = (raw) => (path.basename(raw) === sourceName ? sourceName : path.basename(raw));
  let inFunction = null; // the linker names the function on the line before its errors
  for (const raw of stderr.split(/\r?\n/)) {
    let match = /^(.*?):(\d+):(\d+): (error|warning|note|fatal error): (.*)$/.exec(raw);
    if (match) {
      diagnostics.push({
        file: fileName(match[1]),
        line: Number(match[2]),
        column: Number(match[3]),
        severity: match[4] === "fatal error" ? "error" : match[4],
        message: clean(match[5]),
        origin: "compiler",
      });
      continue;
    }
    match = /^(.*?):(\d+): (Error|Warning): (.*)$/.exec(raw);
    if (match) {
      diagnostics.push({ file: fileName(match[1]), line: Number(match[2]), column: null, severity: match[3].toLowerCase(), message: clean(match[4]), origin: "assembler" });
      continue;
    }
    match = /^(?:.*[\\/])?ld(?:\.exe)?: (?:.*?: )?in function [`'](.*?)'?:$/.exec(raw);
    if (match) {
      inFunction = match[1];
      continue;
    }
    match = /^(.*?\.(?:c|s|S|o)):(?:(\d+):)?\(([^)]*)\): (.*)$/.exec(raw);
    if (match) {
      diagnostics.push({
        file: fileName(match[1]),
        line: match[2] ? Number(match[2]) : null,
        column: null,
        severity: "error",
        message: clean(match[4]) + (inFunction ? ` (in function ${inFunction})` : ""),
        origin: "linker",
      });
      continue;
    }
    match = /^(?:.*[\\/])?(ld|collect2|arm-none-eabi-gcc|cc1|as)(?:\.exe)?: (?:(error|warning|fatal error): )?(.*)$/.exec(raw);
    if (match) {
      diagnostics.push({
        file: null,
        line: null,
        column: null,
        severity: match[2] === "warning" ? "warning" : "error",
        message: clean(match[3]),
        origin: match[1] === "ld" || match[1] === "collect2" ? "linker" : "compiler",
      });
    }
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
    "-I", DEVICE_INCLUDE_DIR,
    "-T", path.join(FIRMWARE_DIR, "linker.ld"),
    `-Wl,-Map=${mapPath}`,
    path.join(FIRMWARE_DIR, "startup.s"),
    sourcePath,
    ...(usesDeviceHeader(source) ? [SYSTEM_SOURCE] : []),
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
  const diagnostics = parseDiagnostics(result.stderr, "main.c", workDir);

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
  const symbolTable = {};
  for (const match of symbols.stdout.matchAll(/^([0-9a-fA-F]{8}) [TtDdBbRrWwVv] (\S+)$/gm)) {
    symbolTable[match[2]] = Number.parseInt(match[1], 16);
  }
  const symbol = (name) => symbolTable[name] ?? null;
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
      SystemInit: symbol("SystemInit"),
      SystemCoreClock: symbol("SystemCoreClock"),
    },
    /** Every defined symbol (name -> address), for tests and tooling. */
    symbolTable,
    bytes: (await readFile(elfPath)).length,
  };
}

/** Removes a build directory created by compileFirmware. */
export async function removeBuild(workDir) {
  if (workDir && path.basename(workDir).startsWith("tm4c-build-")) {
    await rm(workDir, { recursive: true, force: true });
  }
}
