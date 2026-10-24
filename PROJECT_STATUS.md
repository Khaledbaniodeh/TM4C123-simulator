# Project Status

**Last updated:** 2026-10-24 (showcase release candidate `release/showcase-rc1`)
**Stage:** Technical preview. Real firmware execution, the interactive
LaunchPad and the circuit workspace are implemented and covered by
automated tests (135 Node + 98 browser tests in CI).
**Public hosted simulator:** No. Local, trusted, single-user mode only.
**Hardware equivalence:** Not verified (no physical LaunchPad comparison yet).

## Status by area

| Area | Status |
|---|---|
| Pinned toolchains (GCC 15.2.1, Renode 1.17.0, SHA-256 verified) | ✅ Implemented and verified |
| Bare-metal startup, linker script, CMSIS-style `TM4C123.h` + `SystemInit` | ✅ Implemented and verified (D-031) |
| Compiler runner (fixed argv, time/size limits, diagnostics, cleanup) | ✅ Implemented and verified (**no container isolation**) |
| Renode TM4C123GH6PM platform, reset, deterministic virtual time | ✅ Implemented and verified |
| SYSCTL clock gating (GPIO, timers, ADC) and RCC/RCC2/PLL clock tree | ✅ Implemented and verified (D-030) |
| GPIO A–F (masked DATA, DIR, DEN, pulls, open drain, LOCK/CR, analog mode) | ✅ Implemented and verified |
| GPIO interrupts → NVIC → ISR | ✅ Verified for falling edge; other modes implemented without dedicated tests |
| SysTick (interrupt and `COUNTFLAG` polling) | ✅ Implemented and verified (examples G, K, L) |
| GPTM timers | ✅ TIMER0A–2A periodic verified; one-shot implemented, untested; capture/PWM reported unsupported |
| ADC0/ADC1 + temperature sensor | ✅ SS3 verified (D-033); SS0–SS2, continuous trigger, averaging untested |
| Bus faults and unsupported-access reporting | ✅ Implemented and verified |
| Board model from TI CAD (SPMR240) + pinout check (SPMU296) | ✅ Verified in CI |
| Interactive board (pins, tooltips, SW1/SW2, RESET, RGB LED, components) | ✅ Implemented and verified (Playwright) |
| Workspace parts: LED, resistor, pushbutton, potentiometer, LCD1602 | ✅ Implemented and verified (logic level / ideal divider / HD44780) |
| Editing: multi-selection, copy/paste, smart placement, undo/redo | ✅ Implemented and verified (Playwright) |
| Wiring: click-to-click, drag-to-connect, pan while wiring, rerouting | ✅ Implemented and verified (Playwright) |
| Persistence and safe loading (browser drafts, confirm before replacing) | ✅ Implemented and verified (Playwright) |
| Logic analyzer part | 🟡 Editor only, no electrical behavior |
| UART0 + virtual terminal | 📋 Planned (Experiment 10) |
| Container-isolated compile/execute worker | 📋 Planned, **required before any shared deployment** |
| Keil ARMASM sources | ⛔ Unsupported (conversion path documented) |

## Experiments 5–10

| Exp. | Topic | Status |
|---|---|---|
| 5 | GPIO output | ✅ Verified with original C firmware; ⛔ Keil ARMASM source |
| 6 | GPIO inputs & interrupts | ✅ Verified, including `TM4C123.h`-style code (J) |
| 7 | SysTick & timers | ✅ Verified (G–I), including `TM4C123.h`-style code (K) |
| 8 | LCD1602 | ✅ Verified (example L) with the Experiment 8 wiring |
| 9 | ADC | ✅ Verified (examples M, N) |
| 10 | UART | 📋 Planned |

Details: [`docs/EXPERIMENT_COMPATIBILITY.md`](docs/EXPERIMENT_COMPATIBILITY.md).

## Known issues

Ranked for the showcase release. None blocks a local, guided demonstration;
the first one blocks any *public* deployment.

| Issue | Rank | Notes |
|---|---|---|
| Compile/execute backend is not isolated | **Blocker for public hosting** (not for local use) | Local trusted mode only; a validated container worker is required first |
| Older saved circuits keep their wire routes, which can pass over unrelated header pads | Minor | New wires are routed clear of unrelated pads (D-035) and the shipped examples cross none; existing wires are never re-routed automatically. Drag a segment to reroute one. Dense circuits get longer routes with more bends |
| The console shows every GPIO transition (e.g. the LCD example) | Important | The Events tab holds the raw stream; console filtering is not implemented |
| Pause stays enabled while halted; some status chips wrap; two-line trust notice on narrow screens | Deferred | Cosmetic |

## Current blockers (engineering)

| Blocker | Resolution step |
|---|---|
| No physical LaunchPad comparison | Run examples A–E and the negative fixtures on hardware and record the results |
| No container isolation | Build and validate a compile/execute worker image (no network, CPU/memory/PID limits, read-only filesystem) |
| Unmodified lab sources are not run in CI | They are not redistributable; an instructor can compile them against `simulator/firmware/include` and report missing names |

## Next engineering task

UART0 with a virtual serial terminal (Experiment 10); see the plan in
[`docs/EXPERIMENT_COMPATIBILITY.md`](docs/EXPERIMENT_COMPATIBILITY.md#next-engineering-task).
