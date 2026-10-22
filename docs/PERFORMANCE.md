# Performance: wall-clock speed of polling firmware

Measured in GitHub Actions (`ubuntu-24.04`, Renode 1.17.0 portable) with
[`tools/perf/countflag-bench.mjs`](../tools/perf/countflag-bench.mjs) and the
[Performance probe workflow](../.github/workflows/perf-probe.yml), at the
50 MHz system clock (`SystemInit`). Every row is 200 ms of virtual time.
Measurement only: no simulator change was made (decision D-034).

## Where the time goes

| Workload | Wall ms (first window) | Wall ms (steady) | × real time (steady) | Peripheral reads |
|---|---|---|---|---|
| SRAM counter loop (CPU only) | ~245 | ~240 | ~0.8 | none |
| SysTick interrupt every 1 ms + `WFI` | ~160 | ~205 | ≥ 1 (paced) | none in the loop |
| SysTick interrupt every 1 ms + spinning main loop | ~280 | — | ~0.7 | none in the loop |
| `SysTick->CTRL` COUNTFLAG polling (`delay_us` style) | ~3100 | ~1550 | ~0.13 | every iteration |
| `SysTick->VAL` polling | ~4100 | — | — | every iteration |
| `SCB->CPUID` polling (no timer involved) | ~2600 | — | — | every iteration |
| `GPIOF->DATA` polling (project C# model) | ~2550 | ~1100 | ~0.18 | every iteration |
| `TIMER0->RIS` polling (project C# model) | ~2480 | ~960 | ~0.21 | every iteration |
| Example L (LCD1602, COUNTFLAG delays) | ~3150 | ~1560 | ~0.13 | in every delay |

All workloads executed exactly the instruction count their virtual time
implies (10,000,000 instructions per 200 ms at 50 MIPS), so virtual time is
unaffected; only wall time differs. Monitor round trip: ~1.5 ms median.

Findings:

1. **The cost is the peripheral (MMIO) access inside Renode**: about
   0.6–0.7 µs of wall time per read, whichever peripheral is read. Renode's
   built-in NVIC/SCB registers cost as much as (or more than) the project's
   C# models, and these loops emit no events.
2. **Not the orchestrator.** Stepping the same window in 50 ms server steps
   (RunFor + event poll + fault check) takes no longer than one long RunFor.
3. **JIT warm-up doubles the first window.** .NET tiered compilation
   optimizes Renode's access path after first use. Runtime settings were
   compared (four consecutive windows each):

   | .NET setting | COUNTFLAG first → steady | Session start |
   |---|---|---|
   | default | 3126 → ~1560 ms | ~7.9 s |
   | `DOTNET_TieredCompilation=0` | ~2430 ms flat | ~8.9 s |
   | `DOTNET_TieredPGO=0` | 4243 → ~2050 ms | ~6.6 s |
   | `DOTNET_TC_QuickJitForLoops=0` | 2585 → ~1720 ms | ~7.9 s |

   No setting is a net improvement: removing the warm-up costs more in steady
   state and in startup. The default runtime is kept.

## Guidance

- Firmware that waits with interrupts and `WFI` (e.g. `SysTick_Config` plus
  a tick counter) runs at or above real time; the server paces it to 1×.
- Busy-wait delays that poll a peripheral register (`COUNTFLAG`, timer
  `RIS`, GPIO) are correct in virtual time but run at roughly 0.06–0.2× real
  time. This is the cost of emulating every register read, not a simulator
  defect; lab code that polls `COUNTFLAG` works unchanged, only more slowly.

## Re-running

Push a change under `tools/perf/` or run the *Performance probe* workflow
manually; results appear as annotations and in the job summary.
