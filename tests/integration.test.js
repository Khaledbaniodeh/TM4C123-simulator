/*
 * End-to-end execution tests (RISK-001 R1D-R1H):
 *   real C -> arm-none-eabi-gcc -> ELF -> Renode Cortex-M4 -> TM4C123 models
 *   -> structured events.
 *
 * Every assertion about a pin is made on events produced by the GPIO model
 * while the CPU executes the firmware, or on the model's resolved state.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MS, exampleSource, fixtureSource, lastLevel, pinChanges, withFirmware } from "./helpers.js";

const SCB_HFSR_FORCED = 1 << 30;
const CFSR_BFARVALID = 1 << 15;
const CFSR_PRECISERR = 1 << 9;

function assertMonotonicSequence(events) {
  const sequenced = events.filter((event) => typeof event.sequence === "number");
  for (let i = 1; i < sequenced.length; i++) {
    assert.ok(sequenced[i].sequence > sequenced[i - 1].sequence, "sequence numbers must increase");
    assert.ok(BigInt(sequenced[i].virtualTimeNs) >= BigInt(sequenced[i - 1].virtualTimeNs), "virtual time must not go backwards");
  }
}

describe("execution: GPIOF PF1 vertical slice", { timeout: 600_000 }, () => {
  it("A: firmware drives PF1 HIGH through SYSCTL + GPIOF", async () => {
    await withFirmware(await exampleSource("gpiof-red-led"), async (session) => {
      // Before the CPU runs, PF1 is not driven.
      assert.equal(await session.pinState("F", 1), "floating");
      assert.equal(pinChanges(session.events, "PF1").length, 0);

      await session.runFor(10n * MS);

      const clock = session.events.find((e) => e.type === "clock-gate-changed" && e.peripheral === "GPIOF");
      assert.ok(clock?.enabled, "firmware must enable the GPIOF clock");

      const changes = pinChanges(session.events, "PF1");
      assert.equal(changes.at(-1).level, 1);
      assert.equal(changes.at(-1).drive, "output");
      assert.ok(BigInt(changes.at(-1).virtualTimeNs) > BigInt(clock.virtualTimeNs), "PF1 rises after the clock is enabled");
      assert.equal(await session.pinState("F", 1), "high");

      // No other Port F pin was driven, and nothing unsupported was touched.
      assert.ok(session.events.filter((e) => e.type === "digital-pin-changed").every((e) => e.pin.pinId === "PF1"));
      assert.equal(session.events.filter((e) => /unsupported|bus-fault/.test(e.type)).length, 0);
      assertMonotonicSequence(session.events);

      const cpu = await session.cpuState();
      assert.equal(cpu.exceptionNumber, 0, "CPU must be in thread mode (no fault)");
      assert.equal(cpu.hfsr, 0);
    });
  });

  it("B: firmware with identical configuration but DATA low keeps PF1 LOW", async () => {
    await withFirmware(await exampleSource("gpiof-led-off"), async (session) => {
      await session.runFor(10n * MS);
      const changes = pinChanges(session.events, "PF1");
      assert.ok(changes.length >= 1, "PF1 must become a driven output");
      assert.ok(changes.every((e) => e.level !== 1), "PF1 must never be HIGH");
      assert.equal(changes.at(-1).level, 0);
      assert.equal(changes.at(-1).drive, "output");
      assert.equal(await session.pinState("F", 1), "low");
    });
  });

  it("negative: missing clock enable raises a precise bus fault and PF1 stays LOW", async () => {
    await withFirmware(await fixtureSource("missing-clock.c"), async (session, firmware) => {
      await session.runFor(10n * MS);
      const fault = session.events.find((e) => e.type === "bus-fault");
      assert.ok(fault, "a bus-fault event is expected");
      assert.equal(fault.peripheral, "GPIOF");
      assert.equal(fault.address, "0x40025400"); // first access: GPIODIR read-modify-write
      assert.equal(pinChanges(session.events, "PF1").length, 0);
      assert.equal(await session.pinState("F", 1), "floating");

      const cpu = await session.cpuState();
      assert.equal(cpu.exceptionNumber, 3, "bus fault escalates to HardFault (exception 3)");
      assert.ok(cpu.hfsr & SCB_HFSR_FORCED, "HFSR.FORCED");
      assert.ok(cpu.cfsr & CFSR_PRECISERR, "CFSR.PRECISERR");
      assert.ok(cpu.cfsr & CFSR_BFARVALID, "CFSR.BFARVALID");
      assert.equal(cpu.bfar, 0x40025400);
      assert.ok(firmware.elf.symbols.main !== null);

      const cpuFault = session.events.find((e) => e.type === "cpu-fault");
      assert.equal(cpuFault?.exception, "HardFault");
      assert.equal(cpuFault?.bfar, "0x40025400");
    });
  });

  it("negative: missing GPIODIR leaves PF1 undriven", async () => {
    await withFirmware(await fixtureSource("missing-direction.c"), async (session) => {
      await session.runFor(10n * MS);
      assert.ok(pinChanges(session.events, "PF1").every((e) => e.level !== 1));
      assert.equal(await session.pinState("F", 1), "floating");
      assert.equal((await session.cpuState()).exceptionNumber, 0);
    });
  });

  it("negative: missing GPIODEN leaves PF1 undriven", async () => {
    await withFirmware(await fixtureSource("missing-digital-enable.c"), async (session) => {
      await session.runFor(10n * MS);
      assert.ok(pinChanges(session.events, "PF1").every((e) => e.level !== 1));
      assert.equal(await session.pinState("F", 1), "floating");
      assert.equal((await session.cpuState()).exceptionNumber, 0);
    });
  });

  it("reset returns PF1 to its reset state and the firmware runs again", async () => {
    await withFirmware(await exampleSource("gpiof-red-led"), async (session) => {
      await session.runFor(10n * MS);
      assert.equal(await session.pinState("F", 1), "high");

      const before = session.events.length;
      await session.reset();
      const resetEvents = session.events.slice(before);
      assert.ok(resetEvents.some((e) => e.type === "port-snapshot" && e.peripheral === "GPIOF" && e.cause === "reset"));
      assert.equal(lastLevel(session.events, "PF1"), null, "PF1 floats immediately after reset");
      assert.equal(await session.pinState("F", 1), "floating");

      await session.runFor(10n * MS);
      assert.equal(lastLevel(session.events, "PF1"), 1);
      assert.equal(await session.pinState("F", 1), "high");
      assertMonotonicSequence(session.events);
    });
  });

  it("is deterministic: the same firmware yields the same event trace", async () => {
    const source = await exampleSource("gpiof-blink");
    const trace = async () =>
      withFirmware(source, async (session) => {
        await session.runFor(500n * MS);
        return pinChanges(session.events, "PF1").map((e) => `${e.virtualTimeNs}:${e.level}`);
      });
    const first = await trace();
    const second = await trace();
    assert.ok(first.length >= 4, `expected several toggles, got ${first.length}`);
    assert.deepEqual(second, first);
  });

  it("C: blink toggles PF1 with a stable period in virtual time", async () => {
    await withFirmware(await exampleSource("gpiof-blink"), async (session) => {
      await session.runFor(1_000n * MS);
      const edges = pinChanges(session.events, "PF1").filter((e) => e.level !== null);
      const highs = edges.filter((e) => e.level === 1).map((e) => BigInt(e.virtualTimeNs));
      assert.ok(highs.length >= 3, `expected several rising edges, got ${highs.length}`);
      // Event timestamps are synchronized at translation-block boundaries,
      // so allow a jitter of a few instructions (1 us = 16 instructions).
      const periods = highs.slice(1).map((t, i) => t - highs[i]);
      for (const period of periods) {
        const delta = period > periods[0] ? period - periods[0] : periods[0] - period;
        assert.ok(delta <= 1_000n, `period ${period} ns deviates from ${periods[0]} ns by more than 1 us`);
      }
      // ~100k loop iterations of the -O0 delay at 16 MIPS: tens of milliseconds per half period.
      assert.ok(periods[0] > 10n * MS && periods[0] < 1_000n * MS, `unexpected period ${periods[0]} ns`);
    });
  });

  it("D: SW1 (PF4, active-low with pull-up) controls the red LED", async () => {
    await withFirmware(await exampleSource("sw1-red-led"), async (session) => {
      await session.runFor(5n * MS);
      assert.equal(await session.pinState("F", 4), "high", "released switch reads HIGH through the pull-up");
      assert.equal(await session.pinState("F", 1), "low");

      await session.setExternalInput("F", 4, false); // press: switch shorts PF4 to ground
      await session.runFor(5n * MS);
      assert.equal(await session.pinState("F", 4), "low");
      assert.equal(await session.pinState("F", 1), "high");

      await session.setExternalInput("F", 4, null); // release
      await session.runFor(5n * MS);
      assert.equal(await session.pinState("F", 1), "low");
    });
  });

  it("E: GPIO interrupts toggle LEDs from the ISR, with PF0 unlocked", async () => {
    await withFirmware(await exampleSource("switch-interrupts"), async (session) => {
      await session.runFor(5n * MS);
      assert.equal(await session.pinState("F", 0), "high", "PF0 pull-up committed after unlock");
      assert.equal(session.events.filter((e) => e.type === "commit-protected-write-ignored").length, 0);

      const press = async (pin) => {
        await session.setExternalInput("F", pin, false);
        await session.runFor(2n * MS);
        await session.setExternalInput("F", pin, null);
        await session.runFor(2n * MS);
      };

      await press(4);
      assert.equal(await session.pinState("F", 1), "high", "SW1 press toggles red on");
      assert.equal(await session.pinState("F", 3), "low");
      await press(4);
      assert.equal(await session.pinState("F", 1), "low", "second SW1 press toggles red off");
      await press(0);
      assert.equal(await session.pinState("F", 3), "high", "SW2 press toggles green on");

      const irq = session.events.filter((e) => e.type === "interrupt-line-changed" && e.peripheral === "GPIOF");
      assert.ok(irq.filter((e) => e.asserted).length >= 3, "IRQ asserted once per press");
      assert.equal(irq.at(-1).asserted, false, "ISR cleared the interrupt via GPIOICR");
    });
  });

  it("PF0 stays locked: pull-up and DEN writes are not committed without unlock", async () => {
    const source = (await exampleSource("switch-interrupts"))
      .replace("GPIO_PORTF_LOCK_R = GPIO_LOCK_KEY;", "/* unlock removed */")
      .replace("GPIO_PORTF_CR_R  |= PF0_SW2;", "GPIO_PORTF_CR_R  |= PF0_SW2; /* ignored while locked */");
    await withFirmware(source, async (session) => {
      await session.runFor(5n * MS);
      assert.ok(session.events.some((e) => e.type === "locked-register-write-ignored" && e.register === "GPIOCR"));
      const ignored = session.events.filter((e) => e.type === "commit-protected-write-ignored");
      assert.ok(ignored.some((e) => e.register === "GPIOPUR" && e.bits === "0x00000001"));
      assert.ok(ignored.some((e) => e.register === "GPIODEN" && e.bits === "0x00000001"));
      assert.equal(await session.pinState("F", 0), "floating", "PF0 pull-up not applied");
      assert.equal(await session.pinState("F", 4), "high", "PF4 is unaffected by PF0 protection");
    });
  });

  it("reports unsupported, unimplemented, and reserved accesses instead of silently accepting them", async () => {
    await withFirmware(await fixtureSource("unsupported-access.c"), async (session) => {
      await session.runFor(10n * MS);
      const unsupported = session.events.find((e) => e.type === "unsupported-register-access");
      assert.ok(unsupported, "SYSCTL RCGCUART write must be reported");
      assert.equal(unsupported.peripheral, "SYSCTL");
      assert.equal(unsupported.address, "0x400FE618");
      assert.equal(unsupported.access, "write");
      const uart = session.events.find((e) => e.type === "unimplemented-peripheral-access");
      assert.ok(uart, "UART0 access must be reported as an unimplemented peripheral");
      assert.equal(uart.peripheral, "UART0");
      assert.equal(uart.address, "0x4000C000");
      assert.equal(await session.pinState("F", 1), "high", "PF1 was lit before the faulting access");

      const fault = session.events.find((e) => e.type === "cpu-fault");
      assert.ok(fault, "reserved-address access must fault");
      assert.equal(fault.exception, "HardFault");
      assert.equal(fault.bfar, "0x40080000");
      assert.equal(session.events.filter((e) => e.type === "cpu-fault").length, 1, "a fault is reported once");
    });
  });
});
