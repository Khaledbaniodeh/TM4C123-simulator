# TM4C123 Simulator — RISK-001 Feasibility Spike Plan

**Document ID:** RISK-001  
**Version:** 0.1  
**Status:** Ready for execution  
**Depends on:**

- `TM4C123 Simulator MVP Specification v0.1`
- `PM-002 TM4C123 Compatibility Matrix v0.1`
- `PM-003 TM4C123 Architecture Design v0.1`

---

## 1. Purpose

This spike validates the highest-risk technical path before the project invests in the full workspace, board renderer, components, LCD, ADC, timers, or logic analyzer.

The spike must prove this exact end-to-end path:

```text
User C source
→ isolated Cortex-M4 compilation
→ ELF firmware
→ Cortex-M4 execution
→ TM4C123 MMIO/register handling
→ PF1 effective output state
→ backend simulation event
→ visible red LED in a browser
```

The spike is successful only when real compiled firmware changes the LED state. A hardcoded browser toggle, mocked event, preselected final state, or direct UI register modification does not pass.

---

## 2. Locked Technical Direction

| Area | Decision |
|---|---|
| Firmware language | C |
| Target CPU | ARM Cortex-M4, Thumb |
| Compiler | `arm-none-eabi-gcc` |
| Firmware artifact | ELF |
| Execution location | Isolated server-side worker |
| Primary execution candidate | Renode |
| TM4C-specific behavior | Custom SYSCTL and GPIOF peripheral models |
| Peripheral implementation | C# when integrated with Renode |
| Backend/orchestrator | Node.js + TypeScript |
| Browser proof | Minimal HTML/TypeScript indicator |
| Runtime communication | Structured state-change event |
| Production UI | Explicitly outside this spike |

Exact tool versions and container digests are pinned during R1A. Floating `latest` tags are not accepted.

---

## 3. Questions This Spike Must Answer

1. Can a valid Cortex-M4 ELF be produced reproducibly?
2. Can the execution engine load and execute it?
3. Can firmware access the real TM4C123 MMIO addresses?
4. Can custom SYSCTL and GPIOF models enforce correct register behavior?
5. Can PF1 become HIGH only after all required initialization conditions are satisfied?
6. Can the effective PF1 change be exported as a structured event?
7. Can a browser display that event without faking the hardware result?
8. Can compilation and execution be isolated and terminated safely?
9. Is the selected execution approach suitable for continuing the MVP?

---

## 4. Explicit Non-Goals

RISK-001 must not implement:

- Full React workspace.
- `diagram.json`.
- Board SVG or header pins.
- External LED, button, resistor, or wires.
- SysTick.
- NVIC or interrupts.
- GPTM timers.
- LCD1602.
- ADC or potentiometer.
- Logic analyzer.
- Multi-file editor UI.
- Project persistence.
- Full TM4C123 peripheral coverage.
- Full production deployment.
- A hand-written Thumb/Thumb-2 CPU interpreter.

Any of these additions require a separate approved task.

---

## 5. Test Firmware

The spike uses one deterministic program:

```c
#include <stdint.h>

#define SYSCTL_RCGCGPIO_R (*(volatile uint32_t *)0x400FE608u)
#define GPIOF_DIR_R       (*(volatile uint32_t *)0x40025400u)
#define GPIOF_DEN_R       (*(volatile uint32_t *)0x4002551Cu)
#define GPIOF_DATA_R      (*(volatile uint32_t *)0x400253FCu)

int main(void)
{
    SYSCTL_RCGCGPIO_R |= 0x20u;
    GPIOF_DIR_R       |= 0x02u;
    GPIOF_DEN_R       |= 0x02u;
    GPIOF_DATA_R      |= 0x02u;

    for (;;) {
        /* Intentional firmware idle loop. */
    }
}
```

The firmware uses raw addresses only for this spike. CMSIS header integration is a later task.

---

## 6. Required Bare-Metal Boot Support

The firmware build must include:

```text
startup.s
linker.ld
```

They must provide:

- Vector table at `0x00000000`.
- Initial stack pointer inside SRAM.
- Thumb-addressed `Reset_Handler`.
- `.text` and read-only data in Flash.
- `.data` load image in Flash and runtime location in SRAM.
- `.bss` in SRAM.
- `.data` copy during reset.
- `.bss` zero initialization.
- Call to `main`.
- Infinite safe loop if `main` returns.

Required memory regions:

```text
Flash: 0x00000000–0x0003FFFF
SRAM:  0x20000000–0x20007FFF
```

---

## 7. Required MMIO Model

### Addresses

| Register | Address | Required bits |
|---|---:|---|
| `SYSCTL_RCGCGPIO` | `0x400FE608` | Bit 5 enables GPIO Port F |
| `GPIOF_DATA` full access | `0x400253FC` | Bit 1 is PF1 data |
| `GPIOF_DIR` | `0x40025400` | Bit 1 selects output |
| `GPIOF_DEN` | `0x4002551C` | Bit 1 enables digital operation |

### Effective PF1 rule

```text
PF1 effective HIGH =
RCGCGPIO bit 5 is HIGH
AND GPIOF DIR bit 1 is HIGH
AND GPIOF DEN bit 1 is HIGH
AND GPIOF DATA bit 1 is HIGH
```

The LED must not be a direct mirror of the `DATA` register.

### Required negative behavior

- DATA high without GPIO clock → PF1 remains LOW.
- DATA high without output direction → PF1 remains LOW.
- DATA high without digital enable → PF1 remains LOW.
- Unsupported offset inside a modeled block → structured warning.
- Unmapped peripheral access → visible engine/bus warning or fault.
- No unsupported access may silently succeed.

---

# 8. Execution Task Board

## R1A — Toolchain and Engine Pinning

**Objective:** Select and record exact reproducible compiler and execution-engine versions.

**Deliverables:**

- Exact `arm-none-eabi-gcc` version.
- Exact Renode version.
- Container image names and immutable digests, or an equivalent reproducible installation manifest.
- Architecture/host compatibility note.
- License note.
- Commands that print the selected versions.
- Go/no-go report for continuing to R1B.

**Acceptance tests:**

- Compiler version command succeeds.
- Renode version command succeeds.
- Selected artifacts are available in the actual implementation environment.
- No floating `latest` dependency remains.
- No production code is created.

**Dependencies:** None.

---

## R1B — Bare-Metal Firmware Fixture

**Objective:** Create only the startup code, linker script, and fixed PF1 test firmware.

**Allowed output:**

```text
spike/firmware/startup.s
spike/firmware/linker.ld
spike/firmware/main.c
spike/firmware/README.md
```

**Acceptance tests:**

- Vector table begins at `0x00000000`.
- Initial stack pointer is within SRAM.
- `Reset_Handler` has the Thumb bit.
- `.data` and `.bss` initialization are implemented.
- `main` is called.
- No simulator or UI code is added.

**Dependencies:** R1A.

---

## R1C — Isolated Compiler Runner

**Objective:** Compile the R1B fixture into a valid ELF using a fixed profile.

**Locked compiler profile:**

```text
-mcpu=cortex-m4
-mthumb
-mfloat-abi=soft
-O0
-ffreestanding
-fno-builtin
-nostdlib
-nostartfiles
-Wl,-Map=<output>.map
-T <linker.ld>
```

**Mandatory isolation:**

- No outbound network.
- Read-only base filesystem.
- Temporary writable directory.
- CPU limit.
- Memory limit.
- PID/process limit.
- Wall-clock timeout.
- Source-size and file-count limits.
- Artifact-size limit.
- Fixed argument list.
- No shell interpolation of user content.
- Cleanup on success and failure.

**Deliverables:**

```text
spike/compiler/
spike/build/test-pf1.elf
spike/build/test-pf1.map
```

Generated build artifacts may be excluded from Git except approved fixtures.

**Acceptance tests:**

- Valid fixture produces ELF.
- ELF identifies ARM/Thumb firmware.
- Map file is generated.
- Oversized input is rejected.
- Timeout is enforced.
- Network is unavailable inside the compiler runner.
- Temporary files are removed.

**Dependencies:** R1B.

---

## R1D — Minimal Cortex-M4 Execution Platform

**Objective:** Load and run a trivial ELF on a minimal platform containing only CPU, Flash, and SRAM.

**Deliverables:**

```text
spike/execution/platform.repl
spike/execution/run.resc
spike/execution/README.md
```

**Acceptance tests:**

- Platform loads without configuration errors.
- ELF loads from the `.resc` script.
- CPU starts from the vector table.
- Firmware reaches the idle loop without a fault.
- Run is bounded by wall-clock and virtual-execution limits.
- No TM4C peripheral model exists yet.

**Dependencies:** R1C.

---

## R1E — SYSCTL Clock-Gate Model

**Objective:** Implement only `SYSCTL_RCGCGPIO` behavior required for Port F.

**Deliverables:**

```text
spike/execution/peripherals/TM4C123SystemControl.cs
spike/tests/sysctl.robot
```

**Acceptance tests:**

- Register is mapped at `0x400FE608`.
- Reset value is documented.
- Write/readback works for supported bits.
- Bit 5 exposes Port F clock-enabled state.
- Unsupported offsets produce warnings.
- Unit/Robot tests pass.

**Dependencies:** R1D.

---

## R1F — GPIOF PF1 Model

**Objective:** Implement only GPIOF `DIR`, `DEN`, and full-access `DATA` behavior needed by PF1.

**Deliverables:**

```text
spike/execution/peripherals/TM4C123GPIOF.cs
spike/tests/gpiof.robot
```

**Acceptance tests:**

- Registers are mapped at the required addresses.
- Supported read-modify-write behavior works.
- PF1 output is derived from clock + DIR + DEN + DATA.
- Three mandatory negative tests pass.
- Positive PF1 HIGH test passes.
- Effective output never becomes HIGH prematurely.
- State reset returns PF1 LOW.
- Unsupported offsets produce warnings.

**Dependencies:** R1E.

---

## R1G — ELF-to-PF1 Integration

**Objective:** Execute the real R1C ELF against the R1E/R1F models.

**Acceptance tests:**

- Freshly compiled ELF is used.
- Firmware accesses all expected registers.
- No unexpected peripheral access occurs.
- Final effective PF1 state is HIGH.
- The state is produced by firmware execution, not monitor commands.
- Reset returns state to LOW.
- Automated integration test passes from one command.

**Dependencies:** R1C, R1E, R1F.

---

## R1H — Runtime Event Bridge

**Objective:** Export effective PF1 changes from the execution worker as structured events.

**Required event:**

```json
{
  "type": "digital-pin-changed",
  "pin": {
    "partId": "board1",
    "pinId": "PF1"
  },
  "level": 1,
  "sequence": 1,
  "virtualTimeNs": "..."
}
```

**Acceptance tests:**

- Event is emitted only when effective PF1 changes.
- Event contains simulation virtual time.
- Sequence numbers increase monotonically.
- Reset emits or exposes the authoritative LOW state.
- Bridge does not parse human-readable logs as its primary API.
- Duplicate unchanged-state events are not emitted.

**Dependencies:** R1G.

---

## R1I — Minimal Browser Proof

**Objective:** Display one red LED indicator driven only by the runtime event bridge.

**Allowed UI:**

- One status label.
- One red LED indicator.
- Run and Reset controls.
- Optional plain source textarea only if R1C already accepts source input safely.

**Acceptance tests:**

- Page initially shows LED OFF.
- Run compiles/loads/executes the firmware.
- PF1 event turns the LED ON.
- Reset turns the LED OFF.
- Disconnect or runtime failure is visibly reported.
- Browser contains no hardcoded “turn on after Run” shortcut.
- No React workspace or board SVG is introduced.

**Dependencies:** R1H.

---

## R1J — Spike Acceptance and Decision Report

**Objective:** Run all spike tests and issue a formal go/no-go recommendation.

**Required evidence:**

- Exact toolchain identities.
- Build command/result.
- ELF metadata.
- Execution test output.
- Positive GPIO test.
- Three negative GPIO tests.
- Reset test.
- Event bridge test.
- Browser proof screenshot or automated browser result.
- Security/isolation test summary.
- Known limitations.
- Time/cost estimate for continuing with Renode.

**Decision outcomes:**

```text
GO
GO WITH CONDITIONS
NO-GO — evaluate fallback engine
```

**Dependencies:** R1A–R1I.

---

# 9. Dependency Graph

```text
R1A
 ↓
R1B
 ↓
R1C ───────────────┐
 ↓                 │
R1D                │
 ↓                 │
R1E                │
 ↓                 │
R1F                │
 └───────┬─────────┘
         ↓
        R1G
         ↓
        R1H
         ↓
        R1I
         ↓
        R1J
```

No task may begin before all its dependencies are accepted.

---

# 10. Stage Gates

## Gate R-A — Tool Availability

Passed when:

- Compiler is pinned and runnable.
- Renode is pinned and runnable.
- The actual implementation environment can execute both.
- Licenses and architecture compatibility are recorded.

Blocks: R1B onward.

---

## Gate R-B — Firmware Artifact

Passed when:

- Startup/linker fixture is reviewed.
- Valid Cortex-M4 ELF is generated.
- Isolation tests pass.

Blocks: R1D onward.

---

## Gate R-C — CPU Execution

Passed when:

- Minimal platform loads.
- ELF starts correctly from the vector table.
- Firmware reaches its idle loop without fault.

Blocks: Peripheral integration.

---

## Gate R-D — MMIO Correctness

Passed when:

- SYSCTL and GPIOF tests pass.
- All three negative tests pass.
- Firmware drives PF1 HIGH.
- Reset restores PF1 LOW.
- Unsupported accesses are visible.

Blocks: Browser/event work.

---

## Gate R-E — End-to-End Proof

Passed when:

- PF1 state leaves the engine as a structured event.
- Browser visibly reflects that event.
- Run and reset work.
- R1J evidence package is accepted.

Passing Gate R-E closes RISK-001.

---

# 11. Stop Conditions

Stop implementation and return to architecture review when:

1. Renode cannot load the minimal Cortex-M4 platform reliably.
2. Custom peripheral state cannot be observed through a stable programmatic API.
3. The required GPIO model cannot be tested independently.
4. Execution cannot be safely time/resource limited.
5. Toolchain or engine licensing conflicts with the intended distribution.
6. The spike requires implementing a custom CPU decoder.
7. The browser result depends on parsing unstable human-readable logs.
8. The implementation expands into non-goal peripherals to make PF1 work.

A stop condition is not a project failure. It triggers evaluation of the documented fallback engine through a separate ADR.

---

# 12. Expected Spike Repository Structure

```text
spike/
├── README.md
├── toolchain-lock.md
│
├── firmware/
│   ├── startup.s
│   ├── linker.ld
│   ├── main.c
│   └── README.md
│
├── compiler/
│   ├── Dockerfile
│   ├── compile-runner.*
│   └── limits.md
│
├── execution/
│   ├── platform.repl
│   ├── run.resc
│   ├── README.md
│   └── peripherals/
│       ├── TM4C123SystemControl.cs
│       └── TM4C123GPIOF.cs
│
├── bridge/
│   ├── server.*
│   └── runtime-protocol.*
│
├── web/
│   ├── index.html
│   └── main.*
│
└── tests/
    ├── compiler-security.*
    ├── sysctl.robot
    ├── gpiof.robot
    ├── integration.robot
    └── end-to-end.*
```

File extensions marked `*` are selected by the focused implementation task. The architecture recommends TypeScript for Node/browser code.

---

# 13. Definition of Done

RISK-001 is complete only when all of the following are true:

- A reproducible toolchain is pinned.
- The bare-metal fixture builds into a valid ELF.
- Compilation runs inside an isolated bounded environment.
- The execution engine loads and runs the ELF.
- SYSCTL and GPIOF models enforce correct register behavior.
- All positive and negative PF1 tests pass.
- Unsupported accesses do not silently succeed.
- Effective PF1 changes are exported as structured events.
- A browser LED reflects the event.
- Reset restores the authoritative OFF state.
- The evidence package is reviewed.
- The technical manager records a go/no-go decision.

The next project phase may not begin before this definition is satisfied.
