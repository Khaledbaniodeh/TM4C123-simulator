/*
 * Device-support tests: the original CMSIS-style TM4C123.h header,
 * SystemInit()/SystemCoreClock, and lab-style firmware built against them.
 *
 * Compile tests check the header layout (data-sheet offsets as static
 * asserts) and the build integration; execution tests run lab-style code on
 * the simulator and check the behavior through model events.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compileFirmware, removeBuild, usesDeviceHeader } from "../apps/orchestrator/src/compiler.js";
import { MS, exampleSource, fixtureSource, pinChanges, withFirmware } from "./helpers.js";

const US = 1_000n;

async function compiled(source, fn) {
  const result = await compileFirmware(source);
  try {
    return await fn(result);
  } finally {
    await removeBuild(result.workDir);
  }
}

function assertClean(events) {
  const problems = events.filter((event) => /unsupported|unimplemented|bus-fault|cpu-fault|clock-configuration-warning/.test(event.type));
  assert.deepEqual(problems, [], "no unsupported, faulting, or warned accesses");
}

function assertPeriod(events, pinId, expectedNs, minimum) {
  const times = pinChanges(events, pinId).filter((event) => event.level !== null).map((event) => BigInt(event.virtualTimeNs));
  const intervals = times.slice(2).map((time, index) => time - times[index + 1]);
  assert.ok(intervals.length >= minimum, `${pinId}: expected at least ${minimum} periods, got ${intervals.length}`);
  for (const interval of intervals) {
    const delta = interval > expectedNs ? interval - expectedNs : expectedNs - interval;
    assert.ok(delta <= 5n * US, `${pinId}: period ${interval} ns, expected ${expectedNs} ns`);
  }
}

describe("device header: build", { timeout: 300_000 }, () => {
  it("detects the device-header include", () => {
    assert.equal(usesDeviceHeader('#include "TM4C123.h"\n'), true);
    assert.equal(usesDeviceHeader("#include <TM4C123GH6PM.h>\n"), true);
    assert.equal(usesDeviceHeader('  #  include "TM4C123.h"\n'), true);
    assert.equal(usesDeviceHeader('// #include "TM4C123.h"\n'), false);
    assert.equal(usesDeviceHeader('#include "TM4C123x.h"\n'), false);
    assert.equal(usesDeviceHeader("#include <stdint.h>\n"), false);
  });

  it("every register sits at its data-sheet offset (static asserts compile)", async () => {
    await compiled(await fixtureSource("device-header-layout.c"), (result) => {
      assert.equal(result.ok, true, result.log);
      assert.deepEqual(result.diagnostics, [], result.log);
    });
  });

  it("lab-style examples compile without warnings and link SystemInit", async () => {
    for (const id of ["lab-gpio-interrupts", "lab-systick-timer"]) {
      await compiled(await exampleSource(id), (result) => {
        assert.equal(result.ok, true, `${id}: ${result.log}`);
        assert.deepEqual(result.diagnostics, [], `${id}: ${result.log}`);
        assert.ok(result.elf.symbols.SystemInit !== null, `${id}: SystemInit linked`);
        assert.ok(result.elf.symbols.SystemCoreClock !== null, `${id}: SystemCoreClock linked`);
      });
    }
  });

  it("register-level firmware without the header does not get SystemInit", async () => {
    await compiled(await exampleSource("gpiof-red-led"), (result) => {
      assert.equal(result.ok, true, result.log);
      assert.equal(result.elf.symbols.SystemInit, null);
      assert.equal(result.elf.symbols.SystemCoreClock, null);
    });
  });

  it("CMSIS features outside the provided subset fail to build instead of silently doing nothing", async () => {
    const source = '#include "TM4C123.h"\nint main(void) { ITM_SendChar(65); for (;;) {} }\n';
    await compiled(source, (result) => {
      assert.equal(result.ok, false);
      assert.match(result.log, /ITM_SendChar/);
    });
  });
});

describe("device header: execution", { timeout: 600_000 }, () => {
  it("SystemInit configures 50 MHz before main and SystemCoreClock reports it", async () => {
    await withFirmware(await exampleSource("lab-systick-timer"), async (session, firmware) => {
      await session.runFor(5n * MS);
      const clocks = session.events.filter((event) => event.type === "system-clock-changed");
      assert.equal(clocks.at(-1).hz, 50_000_000);
      assert.equal(clocks.at(-1).source, "PLL(MOSC)");
      assert.equal(await session.readWord(firmware.elf.symbols.SystemCoreClock), 50_000_000);
    });
  });

  it("SystemCoreClockUpdate matches the data sheet and the simulator for six configurations", async () => {
    await withFirmware(await fixtureSource("system-clock-update.c"), async (session, { elf }) => {
      await session.runFor(20n * MS);
      assert.equal(await session.readWord(elf.symbolTable.g_done), 1, "fixture ran to completion");
      const results = [];
      for (let index = 0; index < 6; index++) {
        results.push(await session.readWord(elf.symbolTable.g_results + 4 * index));
      }
      assert.deepEqual(results, [50_000_000, 80_000_000, 40_000_000, 16_000_000, 20_000_000, 4_000_000]);

      // Every value the firmware computed is a clock the simulator also derived.
      const simulated = new Set(session.events.filter((event) => event.type === "system-clock-changed").map((event) => event.hz));
      for (const hz of results) {
        assert.ok(simulated.has(hz), `simulator never ran at ${hz} Hz`);
      }
      assert.equal(session.events.filter((event) => event.type === "system-clock-changed").at(-1).hz, 4_000_000);
    });
  });

  it("J: Exp 6 style switch interrupts work through GPIOF->, NVIC->IP, and NVIC_EnableIRQ", async () => {
    await withFirmware(await exampleSource("lab-gpio-interrupts"), async (session) => {
      await session.runFor(5n * MS);
      assertClean(session.events);
      assert.equal(await session.pinState("F", 0), "high", "PF0 unlocked and pulled up");
      assert.equal(await session.pinState("F", 4), "high");

      // NVIC->IP[30] = 3 << 5: byte 2 of IPR7 (0xE000E41C).
      assert.equal(((await session.readWord(0xe000e41c)) >>> 16) & 0xff, 0x60);
      assert.ok((await session.readWord(0xe000e100)) & (1 << 30), "ISER0 bit 30");

      const press = async (pin) => {
        await session.setExternalInput("F", pin, false);
        await session.runFor(2n * MS);
        await session.setExternalInput("F", pin, null);
        await session.runFor(2n * MS);
      };
      await press(4);
      assert.equal(await session.pinState("F", 1), "high", "SW1 toggles red on");
      await press(0);
      assert.equal(await session.pinState("F", 3), "high", "SW2 toggles green on");
      await press(4);
      assert.equal(await session.pinState("F", 1), "low", "SW1 toggles red off");
      assertClean(session.events);
    });
  });

  it("K: Exp 7 style SysTick_Config(SystemCoreClock / 10) and TIMER1A at SystemCoreClock / 2", async () => {
    await withFirmware(await exampleSource("lab-systick-timer"), async (session) => {
      await session.runFor(2_100n * MS);
      assertClean(session.events);

      // SysTick_Config sets the lowest priority (7 << 5) in SHPR3[31:24];
      // NVIC_SetPriority(TIMER1A_IRQn, 2) sets IP[21] = 2 << 5 (IPR5 byte 1).
      assert.equal((await session.readWord(0xe000ed20)) >>> 24, 0xe0);
      assert.equal(((await session.readWord(0xe000e414)) >>> 8) & 0xff, 0x40);
      assert.equal((await session.readWord(0xe000e010)) & 0x7, 0x7, "SysTick CTRL = ENABLE | TICKINT | CLKSOURCE");
      assert.equal(await session.readWord(0xe000e014), 5_000_000 - 1, "SysTick LOAD");

      const started = session.events.find((event) => event.type === "timer-started" && event.peripheral === "TIMER1A");
      assert.equal(started?.periodClocks, 25_000_000);
      assertPeriod(session.events, "PF3", 100n * MS, 15);
      assertPeriod(session.events, "PF2", 500n * MS, 2);
    });
  });
});
