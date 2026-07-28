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

**Status:** Conditional

**Condition:**

`RISK-001` must successfully prove the complete execution path.

**Decision:**

The initial MVP will compile and execute firmware on isolated server-side workers.

Browser-side execution may be researched later but is not required for the first MVP.

---

### D-005 — Renode as the Initial Execution-Engine Candidate

**Status:** Conditional

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

**Status:** Conditional

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

**Status:** Conditional

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

**Status:** Proposed

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
| D-004 | Server-side initial execution | Conditional |
| D-005 | Renode engine candidate | Conditional |
| D-006 | No custom CPU interpreter | Accepted |
| D-007 | Custom TM4C peripherals | Conditional |
| D-008 | C# Renode models | Conditional |
| D-009 | React + TypeScript frontend | Proposed |
| D-010 | Node.js + TypeScript orchestrator | Proposed |
| D-011 | Wokwi-inspired `diagram.json` | Accepted |
| D-012 | Logical electrical model | Accepted |
| D-013 | Virtual time | Accepted |
| D-014 | Small task workflow | Accepted |
| D-015 | PF1 first vertical slice | Accepted |
