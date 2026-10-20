/*
 * Performance probe: where does wall time go when firmware polls SysTick
 * COUNTFLAG? Runs in GitHub Actions (tools/perf workflow); measures only,
 * changes nothing in the simulator.
 *
 * Every workload runs the same virtual-time window. For each it reports:
 *   - raw:      wall ms for one `emulation RunFor` of the window (Renode only)
 *   - stepped:  wall ms for the same window in 50 ms session steps, as the
 *               server runs it (RunFor + event poll + fault check per step)
 *   - x real:   virtual / wall for the raw run
 *   - instr:    instructions executed in the raw window (if Renode reports it)
 *   - MIPS:     emulated instructions per wall second
 *   - events:   simulator events produced in the window
 * plus the Monitor round-trip latency.
 */
import { appendFile } from "node:fs/promises";
import { compileFirmware, removeBuild } from "../../apps/orchestrator/src/compiler.js";
import { RenodeSession } from "../../apps/orchestrator/src/renode-session.js";

const MS = 1_000_000n;
const WINDOW_NS = 200n * MS;
const STEP_NS = 50n * MS;

const header = '#include "TM4C123.h"\n';
const leds = `
static void leds_init(void)
{
    SYSCTL->RCGCGPIO |= (1u << 5);
    while ((SYSCTL->PRGPIO & (1u << 5)) == 0u) { }
    GPIOF->DIR |= 0x0Eu;
    GPIOF->DEN |= 0x0Eu;
}
`;

const WORKLOADS = [
  {
    id: "spin-ram",
    what: "CPU only: volatile SRAM counter loop (no peripheral access)",
    source: `${header}volatile uint32_t g_count;
int main(void) { for (;;) { g_count++; } }`,
  },
  {
    id: "countflag-poll",
    what: "SysTick COUNTFLAG polling (1 ms period), as in delay_us()",
    source: `${header}volatile uint32_t g_count;
int main(void)
{
    SysTick->LOAD = SystemCoreClock / 1000u - 1u;
    SysTick->VAL = 0u;
    SysTick->CTRL = SysTick_CTRL_CLKSOURCE_Msk | SysTick_CTRL_ENABLE_Msk;
    for (;;)
    {
        while ((SysTick->CTRL & SysTick_CTRL_COUNTFLAG_Msk) == 0u) { }
        g_count++;
    }
}`,
  },
  {
    id: "systick-irq-wfi",
    what: "Same 1 ms SysTick period, interrupt-driven with WFI",
    source: `${header}volatile uint32_t g_count;
void SysTick_Handler(void) { g_count++; }
int main(void) { SysTick_Config(SystemCoreClock / 1000u); for (;;) { __WFI(); } }`,
  },
  {
    id: "systick-irq-spin",
    what: "SysTick interrupt every 1 ms, main loop spins (no WFI)",
    source: `${header}volatile uint32_t g_count;
volatile uint32_t g_spin;
void SysTick_Handler(void) { g_count++; }
int main(void) { SysTick_Config(SystemCoreClock / 1000u); for (;;) { g_spin++; } }`,
  },
  {
    id: "systick-val-poll",
    what: "Polling SysTick VAL (another NVIC/SysTick register)",
    source: `${header}volatile uint32_t g_sink;
int main(void)
{
    SysTick->LOAD = 0xFFFFFFu;
    SysTick->CTRL = SysTick_CTRL_CLKSOURCE_Msk | SysTick_CTRL_ENABLE_Msk;
    for (;;) { g_sink = SysTick->VAL; }
}`,
  },
  {
    id: "scb-cpuid-poll",
    what: "Polling SCB CPUID (NVIC peripheral, no timer involved)",
    source: `${header}volatile uint32_t g_sink;
int main(void) { for (;;) { g_sink = SCB->CPUID; } }`,
  },
  {
    id: "gpio-poll",
    what: "Polling GPIOF DATA (project C# peripheral)",
    source: `${header}${leds}volatile uint32_t g_sink;
int main(void) { leds_init(); for (;;) { g_sink = GPIOF->DATA; } }`,
  },
  {
    id: "timer-ris-poll",
    what: "Polling GPTM TIMER0 RIS (project C# peripheral backed by a LimitTimer)",
    source: `${header}volatile uint32_t g_count;
int main(void)
{
    SYSCTL->RCGCTIMER |= 1u;
    while ((SYSCTL->PRTIMER & 1u) == 0u) { }
    TIMER0->CTL = 0u; TIMER0->CFG = 0u; TIMER0->TAMR = 2u;
    TIMER0->TAILR = SystemCoreClock / 1000u - 1u;
    TIMER0->CTL = 1u;
    for (;;) { while ((TIMER0->RIS & 1u) == 0u) { } TIMER0->ICR = 1u; g_count++; }
}`,
  },
];

async function measure(workload, steppedToo = true) {
  const build = await compileFirmware(workload.source);
  if (!build.ok) {
    throw new Error(`${workload.id}: build failed\n${build.log}`);
  }
  const session = await RenodeSession.start(build.elfPath);
  try {
    if (workload.setup) {
      await workload.setup(session);
    }
    // Warm up past reset/SystemInit and translation-cache fill.
    await session.runFor(20n * MS);

    const instructions = async () => {
      try {
        const text = await session.command("cpu ExecutedInstructions");
        const match = /(\d+)/.exec(text.replace(/0x[0-9a-f]+/gi, (hex) => String(Number.parseInt(hex, 16))));
        return match ? Number(match[1]) : null;
      } catch {
        return null;
      }
    };

    const eventsBefore = session.events.length;
    const i0 = await instructions();
    const t0 = performance.now();
    await session.command(`emulation RunFor "${(Number(WINDOW_NS) / 1e9).toFixed(9)}"`);
    const raw = performance.now() - t0;
    const i1 = await instructions();
    await session.poll();
    const events = session.events.length - eventsBefore;

    let stepped = null;
    if (steppedToo) {
      const t1 = performance.now();
      for (let done = 0n; done < WINDOW_NS; done += STEP_NS) {
        await session.runFor(STEP_NS);
      }
      stepped = performance.now() - t1;
    }

    const executed = i0 !== null && i1 !== null ? i1 - i0 : null;
    return {
      id: workload.id,
      what: workload.what,
      rawMs: raw,
      steppedMs: stepped,
      realTime: Number(WINDOW_NS) / 1e6 / raw,
      instructions: executed,
      mips: executed === null ? null : executed / (raw / 1000) / 1e6,
      events,
    };
  } finally {
    await session.close();
    await removeBuild(build.workDir);
  }
}

async function roundTrip() {
  const build = await compileFirmware(WORKLOADS[0].source);
  const session = await RenodeSession.start(build.elfPath);
  try {
    const samples = [];
    for (let i = 0; i < 30; i++) {
      const t = performance.now();
      await session.command("cpu PC");
      samples.push(performance.now() - t);
    }
    samples.sort((a, b) => a - b);
    return { medianMs: samples[15], p90Ms: samples[27] };
  } finally {
    await session.close();
    await removeBuild(build.workDir);
  }
}

const results = [];
for (const workload of WORKLOADS) {
  results.push(await measure(workload));
}

// The real Experiment 8 workload (example L) for reference.
const { readFile } = await import("node:fs/promises");
const lcdSource = await readFile(new URL("../../examples/lcd1602-hello/main.c", import.meta.url), "utf8");
results.push(await measure({
  id: "example-L-lcd",
  what: "Example L (LCD1602, COUNTFLAG delays), RW tied low",
  source: lcdSource,
  setup: (session) => session.setExternalInput("B", 1, false),
}));

const latency = await roundTrip();

const fmt = (value, digits = 1) => (value === null ? "n/a" : value.toFixed(digits));
const lines = [
  "| workload | raw wall ms / 200 ms | stepped wall ms | × real time | instructions | MIPS (wall) | events | description |",
  "|---|---|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.id} | ${fmt(r.rawMs, 0)} | ${fmt(r.steppedMs, 0)} | ${fmt(r.realTime, 3)} | ${r.instructions ?? "n/a"} | ${fmt(r.mips, 2)} | ${r.events} | ${r.what} |`),
  "",
  `Monitor round trip: median ${fmt(latency.medianMs, 2)} ms, p90 ${fmt(latency.p90Ms, 2)} ms`,
];
console.log(lines.join("\n"));
if (process.env.GITHUB_STEP_SUMMARY) {
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `## COUNTFLAG performance probe\n\n${lines.join("\n")}\n`);
}
for (const r of results) {
  console.log(`::notice title=perf ${r.id}::raw=${fmt(r.rawMs, 0)}ms stepped=${fmt(r.steppedMs, 0)}ms x=${fmt(r.realTime, 3)} instr=${r.instructions ?? "n/a"} mips=${fmt(r.mips, 2)} events=${r.events}`);
}
console.log(`::notice title=perf monitor-round-trip::median=${fmt(latency.medianMs, 2)}ms p90=${fmt(latency.p90Ms, 2)}ms`);
