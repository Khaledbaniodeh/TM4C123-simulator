# Project Status

**Last updated:** 2026-10-19 (workspace increment on `feat/wokwi-workspace`)
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
| SYSCTL GPIO clock gating | ✅ Implemented and verified |
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
| SysTick | 🟡 Engine-provided, not verified |
| Clock tree (RCC/RCC2/PLL) | 📋 Planned |
| GPTM TIMER0A–2A | 📋 Planned |
| LCD1602 | 📋 Planned |
| ADC0 SS3 | 📋 Planned |
| UART0 + virtual terminal | 📋 Planned (scope added by D-022) |
| CMSIS-compatible device header, Keil ARMASM conversion | 📋 Planned / ⛔ ARMASM unsupported |
| Container-isolated worker | 📋 Planned — required before any shared deployment |
| Logic analyzer, component wiring editor | 📋 Planned |

## Experiments 5–10

| Exp. | Topic | Status |
|---|---|---|
| 5 | GPIO output | ✅ Hardware behavior verified with original C firmware; ⛔ Keil ARMASM source |
| 6 | GPIO inputs & interrupts | ✅ Hardware behavior verified with original C firmware; ⛔ `TM4C123.h` lab code |
| 7 | SysTick & timers | 📋 Planned |
| 8 | LCD1602 | 📋 Planned |
| 9 | ADC | 📋 Planned |
| 10 | UART | 📋 Planned |

Details: [`docs/EXPERIMENT_COMPATIBILITY.md`](docs/EXPERIMENT_COMPATIBILITY.md).

## Current blockers

| Blocker | Resolution step |
|---|---|
| No physical LaunchPad comparison | Run examples A–E and the negative fixtures on hardware; record the results |
| No container isolation | Build and validate a compile/execute worker image (no network, CPU/memory/PID limits, read-only FS) |
| Lab code needs `TM4C123.h` + 50 MHz clock | Original device header + `SystemInit`, plus the SYSCTL clock-tree model (D-023) |

## Next engineering task

Clock tree + SysTick verification, then GPTM TIMER0A–2A (Experiment 7). See
the plan at the end of
[`docs/EXPERIMENT_COMPATIBILITY.md`](docs/EXPERIMENT_COMPATIBILITY.md#next-engineering-task).
