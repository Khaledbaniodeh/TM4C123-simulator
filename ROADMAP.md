# Project Roadmap

Organized around small, verifiable stage gates. An item is checked only
when its implementation and acceptance tests pass.

## Phase 0 — Planning and Risk Reduction ✅

- [x] Define MVP scope, components, laboratory examples, registers.
- [x] Define architecture and the RISK-001 feasibility spike.
- [x] Provision a working implementation environment (pinned project-local toolchains).
- [x] Pin compiler and execution-engine versions (`tools.lock.json`).
- [x] Complete the first end-to-end feasibility proof ([report](docs/RISK-001_Acceptance_Report.md)).

## Phase 1 — Foundation

- [x] Repository workspace structure (`apps/`, `simulator/`, `examples/`, `tests/`, `e2e/`).
- [x] Automated tests (Node test runner, Playwright).
- [x] CI workflow (GitHub Actions, Linux).
- [x] Runtime event protocol ([`RUNTIME_EVENTS.md`](docs/RUNTIME_EVENTS.md)).
- [ ] Containerized compile/execute worker with validated isolation.
- [x] `diagram.json` schema, parser, and part registry.

## Phase 2 — Core TM4C123 Behavior

- [x] Memory map, Flash/SRAM, vector-table boot.
- [x] SYSCTL GPIO clock gating.
- [x] GPIO ports A–F (APB aperture).
- [x] On-board RGB LED, SW1, SW2.
- [x] PF0 lock and commit.
- [x] Bus faults for unclocked and reserved accesses.
- [ ] GPIO AHB aperture and alternate-function routing.
- [ ] Hardware comparison on a physical LaunchPad.

## Phase 3 — Interrupts and Timing (Experiments 6–7)

- [x] NVIC integration and GPIO edge interrupts.
- [x] Clock tree: RCC/RCC2/PLL, `SystemCoreClock` (D-030, D-031).
- [x] SysTick verification: LOAD/VAL/CTRL, interrupt, COUNTFLAG polling.
- [ ] SysTick `CLKSOURCE` = 0 (PIOSC/4) — not yet tested.
- [x] GPTM TIMER0A, TIMER1A, TIMER2A (16/32-bit periodic, prescaler).
- [x] CMSIS-compatible device header (original, license-compatible; D-031).

## Phase 4 — LCD1602 (Experiment 8)

- [x] HD44780 state model, 4-bit protocol, command set, DDRAM/cursor (D-032).
- [x] Port B connection profile with RW tied low (D-024).
- [x] Browser LCD rendering from firmware transactions only.

## Phase 5 — ADC (Experiment 9)

- [x] ADC0 SS3, PE3/AIN0, polling path; SS3 interrupt path (verified on ADC1) (D-033).
- [x] Virtual potentiometer driving AIN pins; inputs applied between run steps and logged with virtual time.
- [ ] ADC SS0–SS2, continuous trigger, hardware averaging — implemented, not yet tested.

## Phase 6 — UART (Experiment 10)

- [ ] UART0 on PA0/PA1, baud generation from the system clock.
- [ ] Virtual serial terminal with input injection.

## Phase 7 — Workspace and Presentation

- [x] Editor, compile/run/pause/reset/stop, diagnostics, pin inspector.
- [ ] Logic analyzer (virtual-time waveforms).
- [x] Component wiring editor (external LED, pushbutton, potentiometer, LCD1602).
- [ ] Keil ARMASM → GNU assembler conversion helper.

## MVP Completion Condition

The MVP is complete only when real compiled user C code drives simulated
TM4C123 register behavior and visible components for Experiments 5–10,
with each experiment's acceptance tests passing.
