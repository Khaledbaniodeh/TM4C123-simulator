# Project Decision Log

This document records important project decisions that affect architecture, scope, compatibility, security, or implementation direction.

Major decisions may later receive a dedicated Architecture Decision Record (ADR).

---

## Decision Status

Each decision uses one of the following statuses:

| Status | Meaning |
|---|---|
| Proposed | Under discussion and not approved |
| Conditional | Approved only if a named feasibility test passes |
| Accepted | Approved for implementation |
| Rejected | Evaluated and not selected |
| Superseded | Replaced by a newer decision |

---

## Decisions

### D-001 — Execute Real Compiled Firmware

**Status:** Accepted

**Decision:**

The simulator must execute real compiled TM4C123 C firmware.

Frontend scripting or hardcoded UI behavior is not an acceptable replacement for MCU execution.

**Reason:**

The project must demonstrate:

```text
C source
→ ARM firmware
→ register behavior
→ simulated hardware output
```

---

### D-002 — Use ELF as the Primary Firmware Artifact

**Status:** Accepted

**Decision:**

The primary firmware artifact will be an ELF file.

**Reason:**

ELF preserves:

- Program sections.
- Entry point.
- Vector table.
- Symbols.
- Future debugging information.

---

### D-003 — Isolate Compilation and Execution

**Status:** Accepted

**Decision:**

User-provided source code and firmware must run inside isolated and resource-limited workers.

**Required controls:**

- No outbound network by default.
- CPU limits.
- Memory limits.
- Process limits.
- Wall-clock timeout.
- Temporary working directories.
- Guaranteed cleanup.

---

### D-004 — Server-Side Execution for the Initial MVP

**Status:** Accepted for local development (2026-10-19, see D-016). Public multi-user execution remains blocked on D-003 isolation.

**Condition:**

`RISK-001` must successfully prove the complete execution path.

**Decision:**

The initial MVP will compile and execute firmware on isolated server-side workers.

Browser-side execution may be researched later but is not required for the first MVP.

---

### D-005 — Renode as the Initial Execution-Engine Candidate

**Status:** Accepted for the GPIO scope (2026-10-19, see D-016). Re-evaluate per peripheral as later milestones land.

**Condition:**

Renode must pass the `RISK-001` feasibility spike.

**Decision:**

Renode is the initial candidate for:

- Cortex-M4 execution.
- ELF loading.
- Virtual time.
- Custom peripheral models.
- Automated testing.

If Renode cannot satisfy the required path, an alternative engine will be evaluated through a separate decision.

---

### D-006 — Do Not Build a Custom Cortex-M4 CPU Interpreter

**Status:** Accepted

**Decision:**

The project will not implement a hand-written Thumb or Thumb-2 instruction decoder as the primary execution engine.

**Reason:**

The project scope is TM4C123 hardware simulation, not full Cortex-M4 CPU implementation.

---

### D-007 — Custom TM4C123 Peripheral Models

**Status:** Accepted (2026-10-19, see D-016)

**Condition:**

Renode custom peripheral development must prove practical during `RISK-001`.

**Decision:**

TM4C123-specific peripherals will be implemented as custom models.

Initial models include:

- System Control.
- GPIO.
- SysTick and NVIC integration.
- GPTM timers.
- ADC0 SS3.

---

### D-008 — C# for Renode Peripheral Models

**Status:** Accepted (2026-10-19, see D-016)

**Condition:**

Renode remains the selected execution engine.

**Decision:**

Custom TM4C123 Renode peripherals will be implemented in C# using Renode's peripheral and register framework.

Python may be used for scripts and tests, but not as the primary implementation for core peripheral models.

---

### D-009 — React and TypeScript Frontend

**Status:** Proposed

**Decision:**

The browser application is expected to use React and TypeScript.

**Reason:**

The frontend requires:

- Interactive board rendering.
- Component placement.
- Wire editing.
- Runtime event handling.
- Code editing.
- Logic-analyzer visualization.

This decision becomes accepted after project-foundation compatibility is verified.

---

### D-010 — Node.js and TypeScript Orchestrator

**Status:** Accepted with amendment (2026-10-19, see D-018): Node.js orchestrator in plain ES modules; TypeScript deferred.

**Decision:**

The backend orchestrator is expected to use Node.js and TypeScript.

**Responsibilities:**

- Compilation requests.
- Simulation sessions.
- Runtime commands.
- Structured events.
- Error mapping.
- Worker cleanup.

This layer must not contain TM4C register behavior.

---

### D-011 — Wokwi-Inspired Project Format

**Status:** Accepted

**Decision:**

The project will use a Wokwi-inspired `diagram.json` format.

**Important:**

This does not claim complete Wokwi compatibility.

The format will describe:

- Parts.
- Positions.
- Rotation.
- Attributes.
- Pin connections.
- Wire routes.

---

### D-012 — Logical Electrical Simulation

**Status:** Accepted

**Decision:**

The MVP will use a logical electrical model rather than a complete SPICE simulation.

The MVP must support:

```text
HIGH
LOW
FLOATING
CONFLICT
```

and a bounded analog input abstraction for the potentiometer and ADC.

---

### D-013 — Virtual Time Is Authoritative

**Status:** Accepted

**Decision:**

Firmware timing must use execution-engine virtual time.

Browser wall-clock time must not control:

- SysTick.
- GPTM timers.
- ADC timing.
- Interrupt timing.
- Logic-analyzer timestamps.

---

### D-014 — Small Task Execution Workflow

**Status:** Accepted

**Decision:**

Implementation must be divided into small tasks.

Every task must define:

- Objective.
- Dependencies.
- Allowed files.
- Forbidden files.
- Acceptance tests.
- Commands to run.
- Non-goals.
- Definition of Done.

No next task begins before the current task is reviewed and accepted.

---

### D-015 — First Vertical Slice Is PF1 Red LED

**Status:** Accepted

**Decision:**

The first required end-to-end implementation path is:

```text
C source
→ Cortex-M4 ELF
→ execution engine
→ SYSCTL and GPIOF MMIO
→ effective PF1 output
→ browser red LED
```

No large workspace or component implementation should begin before this path is proven.

---

## Decision Updates — 2026-10-19

These entries were recorded together with the RISK-001 implementation
(branch `feat/risk-001-pf1-vertical-slice`). Evidence:
[`RISK-001 Acceptance Report`](RISK-001_Acceptance_Report.md).

### D-016 — RISK-001 Outcome: Renode Accepted for the GPIO Scope

**Date:** 2026-10-19
**Status:** Accepted (GO WITH CONDITIONS)

**Decision:**

Renode 1.17.0 is the execution engine. D-004, D-005, D-007, and D-008 move
from Conditional to Accepted for the scope proven by RISK-001: SYSCTL GPIO
clock gating, GPIO ports A–F, GPIO interrupts through the Renode NVIC.

**Reason:**

The complete path (C → GCC ELF → Renode Cortex-M4 → C# TM4C123 models →
structured events → browser) works and is covered by automated tests,
including all three mandatory negative cases and reset. Renode compiles the
C# models at load time, so no Renode fork or build is needed.

**Conditions:**

- Each later peripheral (GPTM, ADC, UART, clock tree) must re-confirm that
  Renode's model or a custom C# model can meet its acceptance tests.
- Container isolation (D-003) must be validated before any non-local use.

### D-017 — Project Identity: "TM4C123 Simulator"

**Date:** 2026-10-19
**Status:** Accepted

**Decision:**

The public name is **TM4C123 Simulator**, subtitle **Cortex-M4 Firmware &
Peripheral Simulation**. Education is a use case, not the identity. The
repository URL is unchanged. The project remains independent and makes no
claim of Texas Instruments affiliation, production readiness, or verified
hardware equivalence.

### D-018 — Orchestrator in Plain ES Modules (Amends D-010)

**Date:** 2026-10-19
**Status:** Accepted

**Decision:**

The orchestrator and web client are plain Node.js/browser ES modules with no
build step and no runtime dependencies. TypeScript (D-009, D-010) is deferred
until the protocol stabilizes; the browser uses no framework yet.

**Reason:**

The RISK-001 surface is small; avoiding a build step keeps the demonstrator
reproducible with only Node.js and the pinned toolchains.

### D-019 — Runtime Event Channel

**Date:** 2026-10-19
**Status:** Accepted

**Decision:**

C# models write JSON-lines events (sequence number, virtual time in ns) to a
per-session file named by `TM4C_EVENT_LOG`; the orchestrator tails it and
forwards events to the browser over Server-Sent Events. CPU faults are read
from the ARMv7-M SCB registers through the Renode Monitor. Renode's
human-readable log is never parsed for state. Schema:
[`RUNTIME_EVENTS.md`](RUNTIME_EVENTS.md).

### D-020 — Hardware-Faithful Faults for Invalid Accesses

**Date:** 2026-10-19
**Status:** Accepted

**Decision:**

- Accessing a GPIO port whose clock is disabled raises a precise bus fault
  (as documented for TM4C123 silicon) and emits a `bus-fault` event.
- Accesses to reserved (unmapped) addresses raise a precise bus fault
  (`sysbus UnhandledAccessBehaviour ThrowException`).
- Registers that exist on the device but are not modeled produce
  `unsupported-register-access` / `unimplemented-peripheral-access` events;
  reads return 0 and writes are ignored.

**Reason:**

RISK-001 requires that unsupported accesses never silently succeed. A
silent "LED stays off" for missing clock enable would hide the real failure
mode students encounter on hardware.

**Open question:** confirm the reserved-address fault behavior on a physical
LaunchPad.

### D-021 — Project-Local Pinned Toolchains; Containers Deferred

**Date:** 2026-10-19
**Status:** Accepted

**Decision:**

`tools.lock.json` pins xPack arm-none-eabi-gcc 15.2.1-1.1 and Renode 1.17.0
with publisher SHA-256 digests; `npm run setup:tools` installs them into the
gitignored `.tools/`. CI uses the same lock file on Linux.

The local server is a **trusted, single-user, loopback-only** mode: compile
and execution run as child processes with time/size limits but without a
sandbox. The containerized worker required by D-003 is not implemented yet
and is a prerequisite for any shared deployment.

### D-022 — UART0 Added to the Planned Scope

**Date:** 2026-10-19
**Status:** Accepted (planned, not implemented)

**Decision:**

The MVP specification excluded "all UART/I2C/SSI modules". Experiment 10
requires UART0 (PA0/PA1, 115200 baud, polling echo), so UART0 with a virtual
serial terminal is added to the planned scope. Other UART, I2C, and SSI
modules remain out of scope.

### D-023 — Lab Firmware Compatibility Prerequisites

**Date:** 2026-10-19
**Status:** Partially implemented — (a) and (b) by D-031, (c) by D-030; ARMASM open

**Decision:**

Experiments 6–10 use the CMSIS-style `TM4C123.h` device header and assume a
50 MHz system clock configured by vendor startup code. Supporting them
requires (a) a license-compatible device header (CMSIS core headers are
Apache-2.0; the TM4C123 device header must be original or compatibly
licensed — vendor headers are not copied), (b) a `SystemInit` /
`SystemCoreClock` implementation, and (c) SYSCTL RCC/RCC2/PLL modeling so
timer, UART, and SysTick rates match. Experiment 5 uses Keil ARMASM syntax,
which the GNU toolchain does not accept; a documented conversion path is
provided and native ARMASM support is not claimed.

### D-024 — LCD1602 RW Connection Profile

**Date:** 2026-10-19
**Status:** Accepted (implemented by D-032)

**Decision:**

Experiment 8 wires RW to ground while its driver also configures PB1 as an
output driven low. The simulator will model RW as tied to ground with PB1
attached to the same net: PB1 LOW is consistent; PB1 HIGH produces a
CONFLICT state and a warning instead of being silently accepted.

---

## Decision Updates — Workspace Increment

Branch `feat/wokwi-workspace`.

### D-025 — Circuit Workspace Architecture

**Date:** 2026-10-19
**Status:** Accepted

**Decision:**

The browser workspace is split into pure, Node-tested modules and a thin
DOM layer:

| Module | Responsibility |
|---|---|
| `workspace/geometry.js` | One world coordinate system (CSS px at 96 dpi, 0.1 in snap grid), rotation, routing, viewBox math |
| `workspace/diagram.js` | `diagram.json` model, validation, serialization, undoable commands |
| `workspace/netlist.js` | Logic-level evaluation of wired parts |
| `workspace/parts.js`, `board/launchpad.js` | Part definitions and original SVG artwork |
| `workspace/canvas.js` | SVG rendering and interaction only |
| `app.js` | Wires the workspace to the real simulation session |

Parts are drawn in one SVG `viewBox`, so parts, pins, and wires share
coordinates through zoom, pan, and rotation. No absolute CSS positioning is
used for the circuit.

### D-026 — Board Geometry from TI CAD Data, Extracted in CI

**Date:** 2026-10-19
**Status:** Accepted

**Decision:**

Physical board coordinates come from TI's Rev A EAGLE design files
(SPMR240). The header-to-GPIO map is checked against the user's guide
(SPMU296) table text. Both TI documents are downloaded only on the CI
runner (`hardware-reference` workflow). Only derived facts (dimensions,
positions, pass/fail) are kept, and TI files are not committed. The SVG
artwork is original.

**Reason:** Guessing pin coordinates or mappings from photos is not
acceptable for a hardware-accurate simulator. Redistributing TI files is
unnecessary.

### D-027 — External Parts Use a Logic-Level Netlist

**Date:** 2026-10-19
**Status:** Accepted (extends D-012)

**Decision:**

Wires, closed pushbuttons, and board-internal shorts (GND pins, R9/R10)
are strong connections. Resistors are weak connections (pull-ups and
series resistors). An external LED lights when its anode net is HIGH and its
cathode net is LOW, using pin states reported by Renode. External drives on
board GPIOs are applied through the real GPIO model (`DriveInput` /
`ReleaseInput`), so the firmware reads them through its registers. Currents,
voltages, and LED brightness are not modeled. Potentiometer, LCD1602, and
logic analyzer are labeled **editor only** until their peripherals exist.

### D-028 — Development Without Local Builds (GitHub Actions Mode)

**Date:** 2026-10-19
**Status:** Accepted

**Decision:**

The owner's workstation must not run builds or store toolchains. Source
edits are pushed, and GitHub Actions runs every compile, Renode simulation,
test, and screenshot. Test failures are reported as annotations, and
screenshots are committed to the `ci-artifacts` branch, so results are
reviewable in a browser without downloading artifacts.

### D-029 — MCU Reset Keeps External Drivers Connected

**Date:** 2026-10-19
**Status:** Accepted

**Decision:**

`machine Reset` resets GPIO registers but keeps external drive state (a
held switch, a wired pull). On a real board those circuits sit outside the
MCU and are unaffected by its reset.

---

### D-030 — Clock Model: System Clock Drives CPU Rate, SysTick, and GPTM

**Date:** 2026-10-20
**Status:** Accepted

**Decision:**

The SYSCTL model derives the system clock from `RCC`/`RCC2` using the
datasheet rules (oscillator source, XTAL table, PLL 400 MHz VCO with the
/2 unless `DIV400`, `SYSDIV`/`SYSDIV2`/`SYSDIV2LSB`). That one frequency is
applied to:

- the CPU instruction rate (Renode `PerformanceInMips` = MHz, i.e. one
  instruction per clock; not cycle-accurate),
- the SysTick core clock (Renode NVIC `Frequency`),
- every GPTM instance (`LimitTimer.Frequency`).

The PLL locks immediately once powered: `RIS.PLLLRIS` is set on power-up and
on every `RCC`/`RCC2` write while powered, and `PLLSTAT.LOCK` mirrors the
power state. Configurations above 80 MHz, PLL use while powered down, and
MOSC selection with `MOSCDIS=1` emit `clock-configuration-warning` events
instead of being silently accepted. If Renode refuses the clock update, an
`unsupported-feature` event (`clock-propagation`) is emitted.

**Rationale:** Experiment 7–10 lab code assumes a 50 MHz PLL clock. Timer
and SysTick periods are then exact in virtual time, and are verified
against `(ILR+1)·(PR+1)` and `LOAD+1` clocks in `tests/timers.test.js`.
Software delay loops scale with the clock, as on silicon, but only
approximately because instruction timing is not modeled.

---

### D-031 — Original CMSIS-Style Device Header and Device-Support Linking

**Date:** 2026-10-20
**Status:** Accepted

**Decision:**

The simulator ships its own device header in `simulator/firmware/include/`:
`TM4C123.h` → `TM4C123GH6PM.h` (interrupt numbers, register structs, and
instances for SYSCTL, GPIO A–F APB/AHB, TIMER0–5, WTIMER0–5, UART0–7,
ADC0–1) plus `tm4c123_cm4.h`, an independent implementation of the
CMSIS-Core subset lab code uses (`NVIC`, `SCB`, `SysTick` layouts,
`NVIC_EnableIRQ`/`SetPriority`/…, `SysTick_Config`, `__enable_irq`, `__WFI`).
Facts come from the TM4C123GH6PM data sheet and the ARMv7-M ARM; no TI or
Arm header text is copied. Every register offset is checked by static
asserts in `tests/fixtures/firmware/device-header-layout.c`.

When the firmware includes `TM4C123.h` or `TM4C123GH6PM.h`, the build also
links `system_TM4C123.c`, and the startup code calls `SystemInit()` (weak
reference) after `.data`/`.bss` initialization, then `main()`. `SystemInit()`
configures the 50 MHz PLL clock that the lab material assumes;
`SystemCoreClockUpdate()` recomputes `SystemCoreClock` from RCC/RCC2.
Register-level firmware that does not include the header is unchanged and
starts at the 16 MHz reset clock.

CMSIS features outside the subset (ITM, MPU helpers, FPU intrinsics, …) are
compile errors, never silent no-ops. Priority bytes are written with
aligned word read-modify-write; the result equals CMSIS byte writes.

**Rationale:** Lab code for Experiments 6–7 then compiles without edits,
while every earlier example builds exactly as before. The actual lab
sources are not redistributable and are not in the repository;
compatibility is verified with original lab-style firmware (examples J, K).

---

### D-032 — LCD1602 as a Workspace Part Driven by GPIO Events

**Date:** 2026-10-20
**Status:** Accepted

**Decision:**

The HD44780 controller is modeled in JavaScript (`apps/web/workspace/hd44780.js`)
as a part of the circuit workspace, not as a Renode peripheral. Its inputs
are the GPIO model's `digital-pin-changed` events from the running firmware,
routed through the wired netlist (`lcd.js`), so any header pins can drive it
and the board's R9/R10 shorts are respected. Pin changes caused by one
register write carry a shared `update` number (`updateIndex`/`updateSize`)
and are applied together; the controller latches on each falling edge of E.
The same module runs in the browser and in the Node tests.

Modeled: power-on reset state, 8-/4-bit transfers, the full write
instruction set, DDRAM 1-/2-line addressing with wrap-around and display
shift, CGRAM, cursor/blink, the A00 ROM (ASCII, ¥, arrows, half-width
katakana; other symbols as a placeholder glyph), and execution-time checks
(37 µs, 1.52 ms, 15 ms power-on). An instruction sent while the controller
is busy is applied and reported as a warning, because on hardware it may or
may not be lost. Not modeled: reads (busy flag, RAM), the 5x10 font, contrast,
and electrical timing below the instruction level (E pulse width, setup and
hold), which virtual time cannot resolve at translation-block granularity.
Characters use a monospace font; CGRAM characters are drawn from the
firmware's bitmaps. The LCD keeps its contents across an MCU reset (it is
outside the MCU, as in D-029).

This implements D-024: in the Experiment 8 diagram RW is wired to GND and
to PB1; the workspace applies the GND tie as an external drive, so PB1
driven HIGH resolves to a pin conflict.

---

## Adding a New Decision

A new decision entry should include:

```text
Decision ID
Date
Status
Decision
Reason
Conditions
Related task or issue
```

Architecture-changing implementation must not begin before the relevant decision is approved.

---

## Current Decision Summary

| ID | Decision | Status |
|---|---|---|
| D-001 | Real compiled firmware | Accepted |
| D-002 | ELF artifact | Accepted |
| D-003 | Isolated workers | Accepted |
| D-004 | Server-side initial execution | Accepted (local) |
| D-005 | Renode engine | Accepted (GPIO scope) |
| D-006 | No custom CPU interpreter | Accepted |
| D-007 | Custom TM4C peripherals | Accepted |
| D-008 | C# Renode models | Accepted |
| D-009 | React + TypeScript frontend | Proposed |
| D-010 | Node.js orchestrator (TypeScript deferred) | Amended by D-018 |
| D-011 | Wokwi-inspired `diagram.json` | Accepted |
| D-012 | Logical electrical model | Accepted |
| D-013 | Virtual time | Accepted |
| D-014 | Small task workflow | Accepted |
| D-015 | PF1 first vertical slice | Accepted |
| D-016 | RISK-001 outcome: Renode GO WITH CONDITIONS | Accepted |
| D-017 | Project identity "TM4C123 Simulator" | Accepted |
| D-018 | Plain ES-module orchestrator | Accepted |
| D-019 | JSON-lines + SSE event channel | Accepted |
| D-020 | Hardware-faithful bus faults | Accepted |
| D-021 | Project-local pinned toolchains; containers deferred | Accepted |
| D-022 | UART0 added to planned scope | Accepted (planned) |
| D-023 | Lab firmware prerequisites (header, clock, ARMASM) | Partially implemented (D-030, D-031) |
| D-024 | LCD1602 RW connection profile | Accepted |
| D-025 | Circuit workspace architecture | Accepted |
| D-026 | Board geometry from TI CAD data, extracted in CI | Accepted |
| D-027 | Logic-level netlist for external parts | Accepted |
| D-028 | Development without local builds (GitHub Actions mode) | Accepted |
| D-029 | MCU reset keeps external drivers connected | Accepted |
| D-030 | System clock drives CPU rate, SysTick, and GPTM | Accepted |
| D-031 | Original CMSIS-style device header and device-support linking | Accepted |
| D-032 | LCD1602 as a workspace part driven by GPIO events | Accepted |
