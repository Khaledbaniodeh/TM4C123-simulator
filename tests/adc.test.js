/*
 * Experiment 9 tests: ADC0/ADC1 sample sequencers, analog inputs from the
 * workspace potentiometer, and the internal temperature sensor.
 *
 * Firmware results are read from target memory (ELF symbols) and checked
 * against the data sheet's transfer functions:
 *   code = round(V / 3.3 V * 4095)          (analog input)
 *   TEMP = 147.5 - 75 * 3.3 * code / 4096   (temperature sensor)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { describeAnalogInput, evaluateAnalog, potPosition } from "../apps/web/workspace/analog.js";
import { parseDiagram } from "../apps/web/workspace/diagram.js";
import { CATALOG } from "../apps/web/workspace/parts.js";
import { repoRoot } from "../scripts/lib/tools.mjs";
import { MS, exampleSource, pinChanges, withFirmware } from "./helpers.js";

const expectedCode = (volts) => Math.min(4095, Math.round((volts / 3.3) * 4095));

async function exampleDiagram(id) {
  const text = await readFile(path.join(repoRoot, "examples", id, "diagram.json"), "utf8");
  const { diagram, errors } = parseDiagram(text, CATALOG);
  assert.deepEqual(errors, []);
  return diagram;
}

function assertClean(events) {
  const problems = events.filter((e) => /unsupported|unimplemented|bus-fault|cpu-fault|adc-input-warning/.test(e.type));
  assert.deepEqual(problems, [], JSON.stringify(problems));
}

const read = (session, elf, name) => session.readWord(elf.symbolTable[name]);

describe("analog evaluation (potentiometer)", () => {
  it("the example circuit puts the wiper of pot1 on PE3 (AIN0)", async () => {
    const diagram = await exampleDiagram("adc-potentiometer");
    const result = evaluateAnalog(diagram, CATALOG);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.pots.pot1.pins, ["PE3"]);
    assert.equal(result.inputs.PE3, 1.65);
  });

  it("follows the knob position between the supply rails", async () => {
    const diagram = await exampleDiagram("adc-potentiometer");
    const at = (position) => {
      const pot = diagram.parts.find((p) => p.id === "pot1");
      const changed = { ...diagram, parts: diagram.parts.map((p) => (p === pot ? { ...p, attrs: { ...p.attrs, position } } : p)) };
      return evaluateAnalog(changed, CATALOG).inputs.PE3;
    };
    assert.equal(at(0), 0);
    assert.equal(at(100), 3.3);
    assert.equal(at(25), 0.825);
    assert.equal(potPosition({ attrs: { position: 150 } }), 100);
    assert.equal(potPosition({ attrs: {} }), 50);
  });

  it("reports missing supplies, non-ADC pins, and a 5 V divider", async () => {
    const diagram = await exampleDiagram("adc-potentiometer");
    const noGround = { ...diagram, connections: diagram.connections.filter((c) => !c.includes("pot1:GND")) };
    const result = evaluateAnalog(noGround, CATALOG);
    assert.equal(result.pots.pot1.volts, null);
    assert.equal(result.inputs.PE3, undefined);

    const toPA2 = { ...diagram, connections: diagram.connections.map((c) => (c.includes("pot1:SIG") ? ["board1:J2.10", "pot1:SIG", "green", []] : c)) };
    assert.ok(evaluateAnalog(toPA2, CATALOG).notes.some((note) => /PA2, which has no ADC input/.test(note)));

    const fiveVolt = { ...diagram, connections: diagram.connections.map((c) => (c.includes("pot1:VCC") ? ["board1:J3.1", "pot1:VCC", "red", []] : c)) };
    const five = evaluateAnalog(fiveVolt, CATALOG);
    assert.equal(five.inputs.PE3, 2.5);
    const full = { ...fiveVolt, parts: fiveVolt.parts.map((p) => (p.id === "pot1" ? { ...p, attrs: { ...p.attrs, position: 100 } } : p)) };
    assert.ok(evaluateAnalog(full, CATALOG).notes.some((note) => /above the 3\.3 V ADC range/.test(note)));
  });
});

describe("analog pin presentation", () => {
  it("shows the wiper voltage and AIN channel on the ADC pin, applied or not yet", async () => {
    const diagram = await exampleDiagram("adc-potentiometer");
    const analog = evaluateAnalog(diagram, CATALOG);
    assert.deepEqual(describeAnalogInput("PE3", analog), {
      level: "1.650 V",
      detail: "pot1 → AIN0 (on Run)",
      tooltip: "Analog: 1.650 V from pot1 on AIN0 (circuit model, ideal divider), applied when the simulation runs",
    });
    const applied = describeAnalogInput("PE3", analog, { applied: true });
    assert.equal(applied.detail, "pot1 → AIN0");
    assert.match(applied.tooltip, /applied to the simulated ADC$/);
    assert.doesNotMatch(applied.tooltip, /measured|FLOATING|not driven/);
  });

  it("follows the knob and flags voltages above the 3.3 V range", async () => {
    const diagram = await exampleDiagram("adc-potentiometer");
    const at = (position, connections = diagram.connections) => evaluateAnalog({
      ...diagram,
      connections,
      parts: diagram.parts.map((p) => (p.id === "pot1" ? { ...p, attrs: { ...p.attrs, position } } : p)),
    }, CATALOG);
    assert.equal(describeAnalogInput("PE3", at(95)).level, "3.135 V");
    assert.equal(describeAnalogInput("PE3", at(0)).level, "0.000 V");
    const fiveVolt = diagram.connections.map((c) => (c.includes("pot1:VCC") ? ["board1:J3.1", "pot1:VCC", "red", []] : c));
    const over = describeAnalogInput("PE3", at(100, fiveVolt), { applied: true });
    assert.equal(over.level, "5.000 V");
    assert.equal(over.detail, "pot1 → AIN0, over 3.3 V");
    assert.match(over.tooltip, /above the 3\.3 V ADC range \(reads full scale; can damage hardware\)$/);
  });

  it("says when there is no source, a conflict, or no analog input at all", async () => {
    const diagram = await exampleDiagram("adc-potentiometer");
    // VCC/GND open: the wiper drives AIN0 but there is no voltage.
    const open = evaluateAnalog({ ...diagram, connections: diagram.connections.filter((c) => !c.includes("pot1:GND")) }, CATALOG);
    assert.deepEqual(describeAnalogInput("PE3", open), {
      level: "NO SOURCE",
      detail: "pot1 → AIN0, VCC/GND open",
      tooltip: "Analog: pot1 drives AIN0, but its VCC/GND are not wired to supply pins, so no voltage is applied",
    });
    // Two wipers on one input: a conflict, nothing applied.
    const pot2 = { ...diagram.parts.find((p) => p.id === "pot1"), id: "pot2", left: 0 };
    const twoPots = evaluateAnalog({
      ...diagram,
      parts: [...diagram.parts, pot2],
      connections: [...diagram.connections, ...diagram.connections.filter((c) => c.some((end) => end.startsWith("pot1:"))).map((c) => c.map((end) => (typeof end === "string" ? end.replace("pot1:", "pot2:") : end)))],
    }, CATALOG);
    assert.equal(twoPots.inputs.PE3, undefined);
    assert.equal(describeAnalogInput("PE3", twoPots).level, "CONFLICT");
    assert.equal(describeAnalogInput("PE3", twoPots).detail, "pot1, pot2 → AIN0");
    // Disconnected wiper, a pin without an ADC channel, and an ADC pin with nothing wired: digital reporting applies.
    const unwired = evaluateAnalog({ ...diagram, connections: diagram.connections.filter((c) => !c.includes("pot1:SIG")) }, CATALOG);
    assert.equal(describeAnalogInput("PE3", unwired), null);
    const toPA2 = evaluateAnalog({ ...diagram, connections: diagram.connections.map((c) => (c.includes("pot1:SIG") ? ["board1:J2.10", "pot1:SIG", "green", []] : c)) }, CATALOG);
    assert.equal(describeAnalogInput("PA2", toPA2), null);
    assert.equal(describeAnalogInput("PE2", evaluateAnalog(diagram, CATALOG)), null);
  });
});

describe("execution: Experiment 9 ADC", { timeout: 900_000 }, () => {
  it("M: ADC0 SS3 converts the AIN0 voltage and the firmware picks the LED", async () => {
    await withFirmware(await exampleSource("adc-potentiometer"), async (session, { elf }) => {
      for (const [volts, led] of [[0.5, "PF3"], [1.65, "PF2"], [3.0, "PF1"]]) {
        await session.setAnalogInput("PE3", volts);
        await session.runFor(30n * MS);
        assert.equal(await read(session, elf, "g_adc"), expectedCode(volts), `${volts} V`);
        assert.equal(await session.pinState("F", Number(led.slice(2))), "high", `${led} lit at ${volts} V`);
      }
      assertClean(session.events);
      assert.equal(await read(session, elf, "g_ris_after_trigger"), 0, "RIS is not set the instant PSSI is written");
      assert.ok((await read(session, elf, "g_samples")) >= 6);

      const completions = session.events.filter((e) => e.type === "adc-sequence-complete" && e.peripheral === "ADC0");
      assert.ok(completions.length >= 6);
      assert.equal(completions.at(-1).sequencer, 3);
      assert.equal(completions.at(-1).trigger, "processor");
      assert.deepEqual(completions.at(-1).samples, [{ step: 0, input: "AIN0", volts: 3, code: expectedCode(3.0) }]);
    });
  });

  it("an unconnected AIN0 reads 0 and is reported once", async () => {
    await withFirmware(await exampleSource("adc-potentiometer"), async (session, { elf }) => {
      await session.runFor(30n * MS);
      assert.equal(await read(session, elf, "g_adc"), 0);
      const warnings = session.events.filter((e) => e.type === "adc-input-warning");
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].kind, "unconnected");
      assert.equal(warnings[0].input, "AIN0");
      assert.equal(await session.pinState("F", 3), "high", "0 V -> green");
    });
  });

  it("a pin without AMSEL is not an analog input: the sample reads 0 and is reported", async () => {
    const source = (await exampleSource("adc-potentiometer")).replace("GPIOE->AMSEL |= AIN0_PE3;", "/* AMSEL not set */");
    await withFirmware(source, async (session, { elf }) => {
      await session.setAnalogInput("PE3", 2.0);
      await session.runFor(30n * MS);
      assert.equal(await read(session, elf, "g_adc"), 0);
      const warning = session.events.find((e) => e.type === "adc-input-warning");
      assert.equal(warning?.kind, "not-analog");
      assert.match(warning.detail, /GPIOAMSEL bit 3 is 0/);
    });
  });

  it("an input above 3.3 V saturates at 4095 and is reported", async () => {
    await withFirmware(await exampleSource("adc-potentiometer"), async (session, { elf }) => {
      await session.setAnalogInput("PE3", 4.0);
      await session.runFor(30n * MS);
      assert.equal(await read(session, elf, "g_adc"), 4095);
      assert.equal(session.events.find((e) => e.type === "adc-input-warning")?.kind, "over-range");
    });
  });

  it("rejects analog inputs on pins without an ADC channel and out-of-range values", async () => {
    await withFirmware(await exampleSource("adc-potentiometer"), async (session) => {
      await assert.rejects(session.setAnalogInput("PA2", 1), /not an analog input/);
      await assert.rejects(session.setAnalogInput("PE3", 9), /out of range/);
      await assert.rejects(session.setDieTemperature(500), /out of range/);
    });
  });

  it("N: the temperature sensor on ADC1 SS3 follows the die temperature, converted in the ISR", async () => {
    await withFirmware(await exampleSource("adc-temperature"), async (session, { elf }) => {
      await session.runFor(350n * MS);
      assertClean(session.events);
      const code25 = Math.round(((147.5 - 25) * 4096) / 247.5);
      assert.equal(await read(session, elf, "g_code"), code25);
      const tenths25 = (await read(session, elf, "g_temp_tenths")) | 0;
      assert.ok(Math.abs(tenths25 - 250) <= 2, `25 C read as ${tenths25 / 10}`);
      assert.equal(await session.pinState("F", 3), "high", "green below 30 C");

      await session.setDieTemperature(45);
      await session.runFor(250n * MS);
      const tenths45 = (await read(session, elf, "g_temp_tenths")) | 0;
      assert.ok(Math.abs(tenths45 - 450) <= 2, `45 C read as ${tenths45 / 10}`);
      assert.equal(await session.pinState("F", 1), "high", "red above 40 C");

      const irq = session.events.filter((e) => e.type === "interrupt-line-changed" && e.peripheral === "ADC1SS3");
      assert.ok(irq.filter((e) => e.asserted).length >= 5, "one interrupt per conversion");
      assert.equal(irq.at(-1).asserted, false, "ISR cleared the interrupt through ADCISC");
      const sample = session.events.filter((e) => e.type === "adc-sequence-complete" && e.peripheral === "ADC1").at(-1).samples[0];
      assert.equal(sample.input, "TS");
      assert.ok((await read(session, elf, "g_conversions")) >= 5);
    });
  });

  it("negative: ADC access without RCGCADC raises a precise bus fault", async () => {
    const source = (await exampleSource("adc-potentiometer"))
      .replace("SYSCTL->RCGCADC |= (1u << 0);             /* ADC0 clock */", "/* ADC0 clock not enabled */")
      .replace("(SYSCTL->PRADC & 1u) == 0u || ", "");
    await withFirmware(source, async (session) => {
      await session.runFor(10n * MS);
      const fault = session.events.find((e) => e.type === "bus-fault");
      assert.equal(fault?.peripheral, "ADC0");
      assert.equal(fault.address, "0x40038000", "first access: ADCACTSS");
      assert.equal((await session.cpuState()).exceptionNumber, 3);
    });
  });

  it("unmodeled triggers and differential sampling are reported", async () => {
    const source = (await exampleSource("adc-potentiometer"))
      .replace("ADC0->EMUX &= ~0xF000u;", "ADC0->EMUX = 0x5000u; /* timer trigger */")
      .replace("ADC0->SSCTL3 = (1u << 2) | (1u << 1);", "ADC0->SSCTL3 = (1u << 2) | (1u << 1) | (1u << 0);");
    await withFirmware(source, async (session) => {
      await session.runFor(5n * MS);
      const features = session.events.filter((e) => e.type === "unsupported-feature" && e.peripheral === "ADC0").map((e) => e.feature);
      assert.ok(features.includes("trigger"), JSON.stringify(features));
      assert.ok(features.includes("differential"), JSON.stringify(features));
    });
  });

  it("the GPIO analog setup (AFSEL + AMSEL on PE3) is no longer reported as unsupported", async () => {
    await withFirmware(await exampleSource("adc-potentiometer"), async (session) => {
      await session.setAnalogInput("PE3", 1);
      await session.runFor(15n * MS);
      assert.equal(session.events.filter((e) => e.type === "unsupported-feature" && e.peripheral === "GPIOE").length, 0);
      assert.ok(pinChanges(session.events, "PE3").every((e) => e.drive !== "output"));
    });
  });
});
