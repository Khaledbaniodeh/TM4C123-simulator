# Project Status

**Last updated:** 2026-10-20 (device-header increment on `feat/device-header`)
**Stage:** Early technical prototype. The RISK-001 vertical slice is
implemented and verified (decision D-016: GO WITH CONDITIONS).
**Public hosted simulator:** No (local trusted mode only).
**Hardware equivalence:** Not verified (no physical LaunchPad comparison yet).

## Status by area

| Area | Status |
|---|---|
| Pinned toolchains (GCC 15.2.1, Renode 1.17.0) | ✅ Implemented and verified |
| Bare-metal startup + linker script | ✅ Implemented and verified |
| Compiler runner (limits, diagnostics, cleanup) | ✅ Implemented and verified (no container isolation) |
| Renode TM4C123GH6PM platform | ✅ Implemented and verified |
| SYSCTL GPIO and timer clock gating | ✅ Implemented and verified |
| GPIO ports A–F (DATA mask, DIR, DEN, pulls, ODR, LOCK/CR) | ✅ Implemented and verified |
| GPIO interrupts + NVIC + ISR | ✅ Implemented and verified (falling edge; other modes implemented without dedicated tests) |
| Bus faults (unclocked, reserved) and unsupported-access reporting | ✅ Implemented and verified |
| Runtime event bridge (JSON lines → SSE) | ✅ Implemented and verified |
| Browser workspace | ✅ Implemented and verified (Playwright) |
| Board model from TI CAD (SPMR240) + pinout check (SPMU296) | ✅ Implemented and verified in CI |
| Interactive board (pins, tooltips, SW1/SW2, RGB LED, selectable components) | ✅ Implemented and verified (Playwright) |
| Circuit workspace (pan/zoom, editing, undo/redo, wiring, diagram.json) | ✅ Implemented and verified (Playwright) |
| External LED / resistor / pushbutton (logic-level netlist) | ✅ Implemented and verified (example F) |
| Potentiometer / LCD1602 / logic analyzer parts | 🟡 Editor only — no electrical behavior |
| CI (GitHub Actions, Linux) | ✅ Builds, simulates, and runs all suites on every push |
| SysTick (interrupt mode, core clock) | ✅ Verified at 16 / 50 / 80 MHz (Renode NVIC; `COUNTFLAG` polling not yet tested) |
| Clock tree (RCC/RCC2/PLL, PLL lock) | ✅ Implemented and verified (D-030; PLL locks instantly) |
| GPTM timers (16/32-bit periodic, prescaler, timeout IRQs) | ✅ Implemented and verified for TIMER0A–2A (one-shot implemented, untested; capture/PWM reported unsupported) |
| LCD1602 | 📋 Planned |
| ADC0 SS3 | 📋 Planned |
| UART0 + virtual terminal | 📋 Planned (scope added by D-022) |
| CMSIS-style device header (`TM4C123.h`), `SystemInit`/`SystemCoreClock` | ✅ Implemented and verified (D-031; original code, lab-style examples J/K) |
| Keil ARMASM sources | ⛔ Unsupported (conversion path documented) |
| Container-isolated worker | 📋 Planned — required before any shared deployment |
| Logic analyzer, component wiring editor | 📋 Planned |

## Experiments 5–10

| Exp. | Topic | Status |
|---|---|---|
| 5 | GPIO output | ✅ Hardware behavior verified with original C firmware; ⛔ Keil ARMASM source |
| 6 | GPIO inputs & interrupts | ✅ Verified with original C firmware, including `TM4C123.h`-style code (J) |
| 7 | SysTick & timers | ✅ Verified with original C firmware (G–I), including `TM4C123.h`-style code (K) |
| 8 | LCD1602 | 📋 Planned |
| 9 | ADC | 📋 Planned |
| 10 | UART | 📋 Planned |

Details: [`docs/EXPERIMENT_COMPATIBILITY.md`](docs/EXPERIMENT_COMPATIBILITY.md).

## Current blockers

| Blocker | Resolution step |
|---|---|
| No physical LaunchPad comparison | Run examples A–E and the negative fixtures on hardware; record the results |
| No container isolation | Build and validate a compile/execute worker image (no network, CPU/memory/PID limits, read-only FS) |
| Unmodified lab sources not run in CI | The lab sources are not redistributable; an instructor can compile them against `simulator/firmware/include` and report any missing names |

## Next engineering task

SysTick `COUNTFLAG` / GPTM one-shot tests, then the LCD1602 model (Experiment 8). See
the plan at the end of
[`docs/EXPERIMENT_COMPATIBILITY.md`](docs/EXPERIMENT_COMPATIBILITY.md#next-engineering-task).
