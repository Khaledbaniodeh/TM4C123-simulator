# RISK-001 — Spike Acceptance and Decision Report (R1J)

**Date:** 2026-10-19
**Branch:** `feat/risk-001-pf1-vertical-slice`
**Recommendation:** **GO WITH CONDITIONS** (recorded as decision D-016)

This report covers the evidence required by
[`RISK-001`](RISK-001_TM4C123_Feasibility_Spike_Plan_v0.1.md) §R1J. All
results below come from commands run on the environment listed, and can be
reproduced with the commands shown.

## 1. Environment

| Item | Value |
|---|---|
| Host | Windows 11 Pro (x64), local developer workstation |
| Node.js | 24.13.1 (CI: 22.x on Ubuntu 24.04) |
| Compiler | xPack GNU Arm Embedded GCC 15.2.1 20251203 (`15.2.1-1.1`), SHA-256 pinned |
| Engine | Renode 1.17.0 (`1.17.0+20260906gitf1dd1b4af`, .NET 8.0.10), SHA-256 pinned |
| Browser (e2e) | Microsoft Edge via Playwright 1.63.0 (CI: Playwright Chromium) |
| Physical hardware | **None** — hardware equivalence not tested |

Reproduce:

```bash
npm run setup:tools   # pinned GCC + Renode into .tools/ (checksummed)
npm ci
npm test              # compiler + Renode integration + API + board-state
PW_CHANNEL=msedge npm run test:e2e   # or plain `npm run test:e2e` after `npx playwright install chromium`
```

## 2. Gates

| Gate | Result | Evidence |
|---|---|---|
| R-A Tool availability | ✅ Passed | `tools.lock.json`, `scripts/setup-tools.mjs`; both tools print versions; licenses: GCC (GPL, toolchain only), Renode (MIT) |
| R-B Firmware artifact | ✅ Passed (isolation partial) | Compiler tests: ELF32 ARM, vector table at 0x0 (155 words), `_estack` = 0x20008000, entry = `Reset_Handler` with Thumb bit, `.data`/`.bss` in SRAM, map file. Limits: size, timeout, temp-dir cleanup, fixed argv. **Not yet:** network/memory/PID isolation (container worker) |
| R-C CPU execution | ✅ Passed | Renode reports `PC = 0x26D, SP = 0x20008000` from the vector table; firmware reaches its idle loop with exception number 0 |
| R-D MMIO correctness | ✅ Passed | Positive PF1, three negative cases, reset, unsupported/unimplemented/reserved access tests |
| R-E End-to-end proof | ✅ Passed | API test streams PF1 HIGH over SSE; Playwright shows the LED turning on, off at reset, on again |

## 3. Test results (2026-10-19, Windows host)

`npm test` — **31 tests, 31 passed, 0 failed** (≈ 2 min 50 s):

```text
compiler runner
  ✔ builds example A into a Cortex-M4 ELF with a valid vector table
  ✔ copies .data and zeroes .bss in Reset_Handler
  ✔ reports real GCC diagnostics for invalid C and produces no ELF
  ✔ fails at link time for an undefined function
  ✔ rejects oversized source before invoking the compiler
  ✔ removes the temporary build directory
  ✔ parses GCC diagnostic lines
execution: GPIOF PF1 vertical slice
  ✔ A: firmware drives PF1 HIGH through SYSCTL + GPIOF
  ✔ B: firmware with identical configuration but DATA low keeps PF1 LOW
  ✔ negative: missing clock enable raises a precise bus fault and PF1 stays LOW
  ✔ negative: missing GPIODIR leaves PF1 undriven
  ✔ negative: missing GPIODEN leaves PF1 undriven
  ✔ reset returns PF1 to its reset state and the firmware runs again
  ✔ is deterministic: the same firmware yields the same event trace
  ✔ C: blink toggles PF1 with a stable period in virtual time
  ✔ D: SW1 (PF4, active-low with pull-up) controls the red LED
  ✔ E: GPIO interrupts toggle LEDs from the ISR, with PF0 unlocked
  ✔ PF0 stays locked: pull-up and DEN writes are not committed without unlock
  ✔ reports unsupported, unimplemented, and reserved accesses instead of silently accepting them
board state
  ✔ starts with every LED off
  ✔ lights an LED only for a GPIO output driving HIGH
  ✔ ignores replayed or out-of-order events by sequence number
  ✔ applies reset snapshots and clears faults
  ✔ maps the LaunchPad switches to their datasheet pins
  ✔ formats virtual time
orchestrator API
  ✔ serves the workspace and the example catalog
  ✔ rejects cross-origin API requests
  ✔ returns real compiler diagnostics for invalid source
  ✔ builds, runs, streams PF1 HIGH, resets, and stops
  ✔ example B streams PF1 LOW and never HIGH
  ✔ forwards SW1 presses to the GPIO model
```

`PW_CHANNEL=msedge npm run test:e2e` — **4 tests, 4 passed**:

```text
ok 1 A: real firmware lights the red LED; Reset MCU turns it off
ok 2 B: identical configuration with DATA low keeps the LED off
ok 3 D: holding SW1 lights the LED through polling firmware
ok 4 edited source invalidates the build, and compile errors are reported
```

The screenshots in [`docs/images/`](images/) (`workspace-red-led.png`,
`workspace-sw1-pressed.png`) were written by these Playwright tests.

## 4. Key observations

**Positive path (example A).** Event trace from the GPIO model (16 MIPS):

```json
{"type":"clock-gate-changed","sequence":7,"virtualTimeNs":"625","peripheral":"GPIOF","enabled":true}
{"type":"digital-pin-changed","sequence":8,"virtualTimeNs":"1500","pin":{"partId":"board1","pinId":"PF1"},"level":0,"state":"low","drive":"output"}
{"type":"digital-pin-changed","sequence":9,"virtualTimeNs":"1500","pin":{"partId":"board1","pinId":"PF1"},"level":1,"state":"high","drive":"output"}
```

PF1 first becomes a LOW output (when `GPIODEN` enables the driver with
`DATA = 0`), then HIGH on the `GPIODATA` write.

**Missing clock.** The first GPIOF access (the `GPIODIR` read-modify-write)
raises a precise bus fault: xPSR exception 3 (HardFault), HFSR.FORCED,
CFSR = PRECISERR | BFARVALID, BFAR = `0x40025400`. PF1 is never driven.
This matches the documented silicon behavior, not just "LED stays off".

**Reset.** `machine Reset` returns every GPIO pin to its reset state (PF1
floating) and the CPU reloads SP/PC from the vector table; resuming re-runs
the firmware and PF1 goes HIGH again.

**Determinism.** Two independent runs of the blink firmware for 500 ms of
virtual time produce identical PF1 edge timestamps.

## 5. Stop conditions (RISK-001 §11)

| # | Condition | Triggered? |
|---|---|---|
| 1 | Renode cannot load the platform reliably | No |
| 2 | No stable programmatic API for peripheral state | No — JSON-lines events + Monitor methods (`PinState`, `DriveInput`) |
| 3 | GPIO model not independently testable | No |
| 4 | Execution cannot be time/resource limited | Partly — virtual-time and wall-time limits exist; OS-level CPU/memory limits require the container worker |
| 5 | Licensing conflict | No known conflict (Renode MIT; GCC used as a tool) |
| 6 | Custom CPU decoder needed | No |
| 7 | Browser depends on parsing human-readable logs | No |
| 8 | Expansion into non-goal peripherals | No — UART/timers/ADC are placeholder regions only |

## 6. Known limitations

- **Isolation.** Compilation and execution run as local child processes
  with time/size limits, no sandbox. Local trusted use only (SECURITY.md).
- **Timing fidelity.** One instruction ≈ one cycle at 16 MIPS; no flash wait
  states, pipeline, or bus timing. Event timestamps are synchronized at
  translation-block granularity (a few instructions).
- **Interactive speed.** Each Monitor round trip costs ~18 ms on the Windows
  host, so the UI runs at ~0.5–0.8× real time with 50 ms steps (shown in the
  UI). Virtual time stays authoritative and deterministic.
- **Clock tree.** PLL/RCC/RCC2 are not modeled; everything assumes the
  16 MHz PIOSC reset clock. Lab code that assumes 50 MHz will run slower.
- **Hardware equivalence.** Not verified on a physical LaunchPad.
- **Lab source compatibility.** CMSIS `TM4C123.h` code and Keil ARMASM need
  the prerequisites in D-023.

## 7. Conditions for continuing with Renode

1. Validate a containerized compile/execute worker (no network, CPU/memory/
   PID limits, read-only filesystem) before any shared deployment.
2. Re-confirm Renode feasibility for each new peripheral (GPTM, ADC, UART,
   clock tree) through the same test-first workflow.
3. Compare representative behaviors (PF0 unlock, interrupts, bus faults,
   reset) against a physical LaunchPad.

**Estimate.** Each subsequent peripheral (clock tree + SysTick, GPTM, ADC0
SS3, UART0 + terminal, LCD1602) is a 1–3 day increment at the current test
depth, assuming no Renode blocker.
