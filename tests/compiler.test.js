/*
 * Compiler runner tests (RISK-001 R1B/R1C): real arm-none-eabi-gcc builds.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { compileFirmware, LIMITS, parseDiagnostics, removeBuild } from "../apps/orchestrator/src/compiler.js";
import { armTool } from "../scripts/lib/tools.mjs";
import { run } from "../apps/orchestrator/src/compiler.js";
import { exampleSource, fixtureSource } from "./helpers.js";

const FLASH_END = 0x40000;
const SRAM_START = 0x20000000;
const SRAM_END = 0x20008000;

describe("compiler runner", () => {
  it("builds example A into a Cortex-M4 ELF with a valid vector table", async () => {
    const result = await compileFirmware(await exampleSource("gpiof-red-led"));
    try {
      assert.equal(result.ok, true, result.log);
      const { elf } = result;
      assert.equal(elf.class, "ELF32");
      assert.equal(elf.machine, "ARM");
      assert.equal(elf.type.split(" ")[0], "EXEC");

      // Entry point is Reset_Handler with the Thumb bit set.
      assert.equal(elf.entry & 1, 1, "entry point must have the Thumb bit");
      assert.equal(elf.entry & ~1, elf.symbols.Reset_Handler);
      assert.ok(elf.symbols.main !== null, "main must be linked");

      // Vector table first in Flash; stack top at the end of SRAM.
      const vectors = elf.sections.find((section) => section.name === ".isr_vector");
      assert.equal(vectors.address, 0);
      assert.equal(vectors.size, (16 + 139) * 4);
      assert.equal(elf.symbols._estack, SRAM_END);

      for (const section of elf.sections) {
        if (section.name === ".data" || section.name === ".bss") {
          assert.ok(section.address >= SRAM_START && section.address + section.size <= SRAM_END, section.name);
        } else {
          assert.ok(section.address + section.size <= FLASH_END, `${section.name} must be in Flash`);
        }
      }

      // Vector table words 0 and 1 are the initial SP and the Reset_Handler address.
      const dump = await run(armTool("objdump"), ["-s", "-j", ".isr_vector", result.elfPath], { timeoutMs: 10_000 });
      const firstRow = /^\s*0000\s+([0-9a-f]{8})\s+([0-9a-f]{8})/m.exec(dump.stdout);
      const littleEndian = (hex) => Number.parseInt(hex.match(/../g).reverse().join(""), 16);
      assert.equal(littleEndian(firstRow[1]), SRAM_END);
      assert.equal(littleEndian(firstRow[2]), elf.entry);

      assert.ok(existsSync(result.mapPath), "map file must be produced");
      assert.match(await readFile(result.mapPath, "utf8"), /\.isr_vector/);
    } finally {
      await removeBuild(result.workDir);
    }
  });

  it("copies .data and zeroes .bss in Reset_Handler", async () => {
    const source = await readFile(new URL("../simulator/firmware/startup.s", import.meta.url), "utf8");
    assert.match(source, /ldr\s+r0, =_sidata/);
    assert.match(source, /ldr\s+r1, =_sbss/);
    assert.match(source, /bl\s+main/);
  });

  it("reports real GCC diagnostics for invalid C and produces no ELF", async () => {
    const result = await compileFirmware(await fixtureSource("compile-error.c"));
    try {
      assert.equal(result.ok, false);
      assert.equal(result.elfPath, undefined);
      assert.ok(!existsSync(`${result.workDir}/firmware.elf`));
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      assert.ok(errors.length >= 1, result.log);
      assert.ok(errors.every((d) => d.file === "main.c" && d.line > 0));
      assert.match(result.log, /expected ',' or ';'|undeclared/);
    } finally {
      await removeBuild(result.workDir);
    }
  });

  it("fails at link time for an undefined function", async () => {
    const result = await compileFirmware(await fixtureSource("link-error.c"));
    try {
      assert.equal(result.ok, false);
      assert.match(result.log, /undefined reference to [`']missing_function'/);
    } finally {
      await removeBuild(result.workDir);
    }
  });

  it("rejects oversized source before invoking the compiler", async () => {
    const result = await compileFirmware("/*" + "x".repeat(LIMITS.maxSourceBytes) + "*/");
    assert.equal(result.ok, false);
    assert.equal(result.workDir, null);
    assert.match(result.error, /limit/);
  });

  it("removes the temporary build directory", async () => {
    const result = await compileFirmware(await exampleSource("gpiof-led-off"));
    assert.equal(result.ok, true, result.log);
    assert.ok(existsSync(result.workDir));
    await removeBuild(result.workDir);
    assert.ok(!existsSync(result.workDir));
  });

  it("parses GCC diagnostic lines", () => {
    const parsed = parseDiagnostics("/tmp/tm4c-build-x/main.c:12:5: error: expected ';' before 'value'\nnote: something");
    assert.deepEqual(parsed, [{ file: "main.c", line: 12, column: 5, severity: "error", message: "expected ';' before 'value'" }]);
  });
});
