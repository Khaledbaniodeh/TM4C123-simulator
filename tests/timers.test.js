/*
 * Experiment 7 execution tests: SYSCTL clock tree (RCC/RCC2/PLL), SysTick,
 * and the GPTM timers.
 *
 * Periods are measured on GPIO events emitted while the CPU executes the
 * firmware's ISRs, in Renode virtual time. Event timestamps are synchronized
 * at translation-block boundaries, so a few microseconds of jitter are
 * tolerated; any wrong clock or divider would be off by milliseconds.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MS, exampleSource, pinChanges, withFirmware } from "./helpers.js";

const US = 1_000n;

/** Intervals (ns) between consecutive level changes of one pin. */
function toggleIntervals(events, pinId) {
  const times = pinChanges(events, pinId)
    .filter((event) => event.level !== null)
    .map((event) => BigInt(event.virtualTimeNs));
  return times.slice(1).map((time, index) => time - times[index]);
}

function assertPeriod(events, pinId, expectedNs, { tolerance = 5n * US, minimum = 3 } = {}) {
  // The first change is the pin becoming a driven output (or the first toggle);
  // every later interval is one timer/SysTick period.
  const intervals = toggleIntervals(events, pinId).slice(1);
  assert.ok(intervals.length >= minimum, `${pinId}: expected at least ${minimum} periods, got ${intervals.length}`);
  for (const interval of intervals) {
    const delta = interval > expectedNs ? interval - expectedNs : expectedNs - interval;
    assert.ok(delta <= tolerance, `${pinId}: period ${interval} ns, expected ${expectedNs} ns (±${tolerance} ns)`);
  }
}

function clockEvents(events) {
  return events.filter((event) => event.type === "system-clock-changed");
}

function assertClean(events) {
  const problems = events.filter((event) => /unsupported|bus-fault|cpu-fault|clock-configuration-warning/.test(event.type));
  assert.deepEqual(problems, [], "no unsupported, faulting, or warned accesses");
}

describe("execution: Experiment 7 clocks, SysTick, and GPTM", { timeout: 900_000 }, () => {
  it("reset selects the 16 MHz PIOSC system clock", async () => {
    await withFirmware(await exampleSource("gpiof-red-led"), async (session) => {
      await session.runFor(1n * MS);
      const before = session.events.length;
      await session.reset();
      const changed = clockEvents(session.events.slice(before));
      assert.equal(changed.length, 1);
      assert.equal(changed[0].hz, 16_000_000);
      assert.equal(changed[0].source, "PIOSC");
      assert.equal(changed[0].pll, false);
      assert.equal(changed[0].cause, "reset");
      assert.equal(await session.readWord(0x400fe060), 0x078e3ad1, "RCC reset value");
      assert.equal(await session.readWord(0x400fe070), 0x07c06810, "RCC2 reset value");
      assert.equal(await session.readWord(0x400fe168), 0, "PLL powered down at reset");
    });
  });

  it("G: PLL raises the clock to 50 MHz and SysTick fires every 100 ms", async () => {
    await withFirmware(await exampleSource("systick-blink"), async (session) => {
      await session.runFor(1_050n * MS);
      assertClean(session.events);

      const final = clockEvents(session.events).at(-1);
      assert.equal(final.hz, 50_000_000);
      assert.equal(final.source, "PLL(MOSC)");
      assert.equal(final.pll, true);
      assert.equal(final.divisor, 8, "400 MHz / (SYSDIV2:SYSDIV2LSB + 1)");

      // PLL lock was observed by the firmware and is visible afterwards.
      assert.ok((await session.readWord(0x400fe050)) & (1 << 6), "RIS.PLLLRIS");
      assert.equal(await session.readWord(0x400fe168), 1, "PLLSTAT.LOCK");

      assertPeriod(session.events, "PF3", 100n * MS, { minimum: 8 });
    });
  });

  it("SysTick follows the core clock: without the PLL the same LOAD takes 312.5 ms", async () => {
    const source = (await exampleSource("systick-blink")).replace("pll_init_50mhz();", "/* PLL left at reset: 16 MHz PIOSC */");
    await withFirmware(source, async (session) => {
      await session.runFor(1_500n * MS);
      assertClean(session.events);
      assert.ok(clockEvents(session.events).every((event) => event.hz === 16_000_000));
      assertPeriod(session.events, "PF3", 312_500n * US, { minimum: 3 });
    });
  });

  it("80 MHz (SYSDIV2 = 4) shortens the SysTick period to 62.5 ms", async () => {
    const source = (await exampleSource("systick-blink")).replace("(7u << 22)", "(4u << 22)");
    await withFirmware(source, async (session) => {
      await session.runFor(500n * MS);
      assertClean(session.events);
      assert.equal(clockEvents(session.events).at(-1).hz, 80_000_000);
      assertPeriod(session.events, "PF3", 62_500n * US, { minimum: 5 });
    });
  });

  it("a divider above the 80 MHz limit is reported as a clock-configuration warning", async () => {
    const source = (await exampleSource("systick-blink")).replace("(7u << 22)", "(3u << 22)");
    await withFirmware(source, async (session) => {
      await session.runFor(50n * MS);
      assert.equal(clockEvents(session.events).at(-1).hz, 100_000_000);
      const warning = session.events.find((event) => event.type === "clock-configuration-warning");
      assert.ok(warning, "expected a clock-configuration-warning event");
      assert.match(warning.detail, /80 MHz/);
    });
  });

  it("H: TIMER1A 16-bit periodic with prescaler 256 times out every 0.33554432 s", async () => {
    await withFirmware(await exampleSource("timer1a-prescaled"), async (session) => {
      await session.runFor(1_800n * MS);
      assertClean(session.events);

      const started = session.events.find((event) => event.type === "timer-started" && event.peripheral === "TIMER1A");
      assert.ok(started, "timer-started event for TIMER1A");
      assert.equal(started.width, 16);
      assert.equal(started.mode, "periodic");
      assert.equal(started.direction, "down");
      assert.equal(started.intervalLoad, 0xffff);
      assert.equal(started.prescale, 255);
      assert.equal(started.periodClocks, 65_536 * 256);
      assert.equal(started.clockHz, 50_000_000);

      // 16,777,216 clocks / 50 MHz = 335.54432 ms.
      assertPeriod(session.events, "PF2", 335_544_320n, { minimum: 3 });

      const irq = session.events.filter((event) => event.type === "interrupt-line-changed" && event.peripheral === "TIMER1A");
      assert.ok(irq.filter((event) => event.asserted).length >= 4, "TIMER1A IRQ asserted once per timeout");
      assert.equal(irq.at(-1).asserted, false, "ISR cleared TATORIS via GPTMICR");
    });
  });

  it("I: TIMER0A/1A/2A run concurrently at 250/500/1000 ms", async () => {
    await withFirmware(await exampleSource("three-timers"), async (session) => {
      await session.runFor(4_100n * MS);
      assertClean(session.events);
      const started = session.events.filter((event) => event.type === "timer-started");
      assert.deepEqual(
        started.map((event) => [event.peripheral, event.width, event.periodClocks]),
        [
          ["TIMER0A", 32, 12_500_000],
          ["TIMER1A", 32, 25_000_000],
          ["TIMER2A", 32, 50_000_000],
        ],
      );
      // ISRs that become pending at the same instant run back to back, so allow
      // for one other ISR's execution time.
      assertPeriod(session.events, "PF1", 250n * MS, { minimum: 12 });
      assertPeriod(session.events, "PF2", 500n * MS, { minimum: 6 });
      assertPeriod(session.events, "PF3", 1_000n * MS, { minimum: 2 });
    });
  });

  it("negative: timer access without RCGCTIMER raises a precise bus fault", async () => {
    const source = (await exampleSource("timer1a-prescaled"))
      .replace("SYSCTL_RCGCTIMER_R |= (1u << 1);", "/* TIMER1 clock not enabled */")
      .replace("while ((SYSCTL_PRTIMER_R & (1u << 1)) == 0u)", "if (0)");
    await withFirmware(source, async (session) => {
      await session.runFor(10n * MS);
      const fault = session.events.find((event) => event.type === "bus-fault");
      assert.ok(fault, "a bus-fault event is expected");
      assert.equal(fault.peripheral, "TIMER1");
      assert.equal(fault.address, "0x4003100C", "first access: GPTMCTL write");
      const cpu = await session.cpuState();
      assert.equal(cpu.exceptionNumber, 3, "bus fault escalates to HardFault");
      assert.equal(cpu.bfar, 0x4003100c);
      assert.equal(pinChanges(session.events, "PF2").filter((event) => event.level === 1).length, 0);
    });
  });

  it("negative: unmodeled capture mode is reported, not silently accepted", async () => {
    const source = (await exampleSource("timer1a-prescaled")).replace("TIMER1_TAMR_R = 0x2u;", "TIMER1_TAMR_R = 0x3u;");
    await withFirmware(source, async (session) => {
      await session.runFor(10n * MS);
      const feature = session.events.find((event) => event.type === "unsupported-feature" && event.peripheral === "TIMER1");
      assert.ok(feature, "expected an unsupported-feature event");
      assert.equal(feature.feature, "capture-mode");
    });
  });

  it("is deterministic: the three-timer trace is identical across runs", async () => {
    const source = await exampleSource("three-timers");
    const trace = () =>
      withFirmware(source, async (session) => {
        await session.runFor(1_100n * MS);
        return session.events
          .filter((event) => event.type === "digital-pin-changed")
          .map((event) => `${event.virtualTimeNs}:${event.pin.pinId}:${event.level}`);
      });
    const first = await trace();
    assert.ok(first.length >= 8, `expected several toggles, got ${first.length}`);
    assert.deepEqual(await trace(), first);
  });
});
