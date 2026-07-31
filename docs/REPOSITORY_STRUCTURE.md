# Repository Structure

This document explains the current repository layout and the proposed structure for future implementation.

The implementation structure is not final until the feasibility spike `RISK-001` is completed and reviewed.

---

## Current Repository Stage

The repository is currently focused on:

- Product scope.
- Compatibility planning.
- Architecture design.
- Feasibility planning.
- Security requirements.
- Contribution guidelines.
- Infrastructure requirements.

There is currently no complete simulator implementation.

---

## Current Top-Level Files

```text
TM4C123-simulator/
├── .github/
├── docs/
├── .gitignore
├── CODE_OF_CONDUCT.md
├── CONTRIBUTING.md
├── HELP_WANTED.md
├── PROJECT_STATUS.md
├── README.md
├── ROADMAP.md
├── SECURITY.md
└── SUPPORT.md
```

---

## Current Documentation Structure

```text
docs/
├── tasks/
├── DECISION_LOG.md
├── GLOSSARY.md
├── INFRASTRUCTURE_REQUIREMENTS.md
├── PM-002_TM4C123_Compatibility_Matrix_v0.1.md
├── PM-003_TM4C123_Architecture_Design_v0.1.md
├── RISK-001_TM4C123_Feasibility_Spike_Plan_v0.1.md
├── REPOSITORY_STRUCTURE.md
└── TM4C123_Simulator_MVP_Specification_v0.1.md
```

The exact filenames may change as documents are revised.

---

## GitHub Configuration

```text
.github/
├── ISSUE_TEMPLATE/
│   ├── architecture-question.md
│   ├── bug-report.md
│   ├── config.yml
│   ├── contribution-offer.md
│   └── technical-help-request.md
└── PULL_REQUEST_TEMPLATE.md
```

These files define:

- Issue templates.
- Pull request requirements.
- Contributor information requirements.
- Architecture-question structure.
- Bug-report structure.

---

## Task Documentation

Small implementation tasks belong in:

```text
docs/tasks/
```

Each task document should define:

- Task ID.
- Objective.
- Dependencies.
- Allowed files.
- Forbidden files.
- Required implementation.
- Acceptance criteria.
- Commands to run.
- Expected evidence.
- Non-goals.
- Definition of Done.

Example:

```text
docs/tasks/R1A-1_Actual_Workspace_Environment_Check.md
```

---

# Proposed Implementation Structure

The following layout is proposed for future implementation.

It must not be treated as final until the architecture and feasibility decisions are approved.

```text
TM4C123-simulator/
├── apps/
│   ├── web/
│   └── orchestrator/
│
├── packages/
│   ├── protocol/
│   ├── diagram-schema/
│   └── shared-types/
│
├── simulator/
│   ├── renode/
│   │   ├── platforms/
│   │   ├── peripherals/
│   │   └── tests/
│   └── firmware-fixtures/
│
├── infrastructure/
│   ├── compiler-worker/
│   ├── simulation-worker/
│   └── ci/
│
├── examples/
├── tests/
├── docs/
└── .github/
```

---

## `apps/web`

Proposed browser application.

Expected responsibilities:

- Source-code editor.
- Board visualization.
- Component placement.
- Wiring interface.
- Compile controls.
- Run, pause, reset, and stop controls.
- Runtime error display.
- LED and button interaction.
- LCD1602 visualization.
- Potentiometer controls.
- Logic-analyzer visualization.

The frontend must not fake firmware behavior.

---

## `apps/orchestrator`

Proposed backend orchestration service.

Expected responsibilities:

- Receive compile requests.
- Validate source and project limits.
- Create isolated compilation jobs.
- Manage simulation sessions.
- Send commands to execution workers.
- Forward structured runtime events.
- Enforce session timeouts.
- Clean temporary resources.

TM4C123 register behavior must not be implemented in this service.

---

## `packages/protocol`

Proposed shared protocol definitions.

Expected content:

- Compile-request types.
- Compile-result types.
- Simulation commands.
- Runtime events.
- Error structures.
- Session-state definitions.

Example event types may include:

```text
compile.started
compile.completed
compile.failed
simulation.started
simulation.paused
simulation.stopped
gpio.output.changed
lcd.state.changed
adc.input.changed
logic.sample
runtime.error
```

The final protocol must be versioned and validated.

---

## `packages/diagram-schema`

Proposed schema for the project wiring format.

Expected responsibilities:

- Validate `diagram.json`.
- Define supported part types.
- Define pin references.
- Define component attributes.
- Define wire connections.
- Reject unknown or malformed fields.

The initial format is Wokwi-inspired but does not claim full Wokwi compatibility.

---

## `packages/shared-types`

Proposed TypeScript definitions shared by applications and packages.

This package should contain only stable shared types.

It must not become a location for unrelated helper functions or hidden business logic.

---

## `simulator/renode`

Proposed Renode-specific implementation.

Expected subdirectories:

```text
simulator/renode/
├── platforms/
├── peripherals/
└── tests/
```

### `platforms`

Expected content:

- TM4C123 platform descriptions.
- CPU and memory mapping.
- Peripheral connections.
- Interrupt connections.
- Initial board configuration.

### `peripherals`

Expected custom models:

- System Control.
- GPIO.
- GPTM timers.
- ADC0 SS3.
- Additional models approved by the compatibility matrix.

### `tests`

Expected content:

- Register-level tests.
- Reset-state tests.
- Interrupt tests.
- MMIO behavior tests.
- Unsupported-access tests.
- Virtual-time tests.

---

## `simulator/firmware-fixtures`

Small firmware programs used to verify simulator behavior.

Expected examples:

```text
gpiof-red-led/
gpiof-rgb-led/
sw1-polling/
pf0-unlock/
gpiof-interrupt/
systick/
timer0a/
adc0-ss3/
lcd1602/
```

Each fixture should contain:

- Source code.
- Startup code.
- Linker script.
- Build instructions.
- Expected simulator behavior.
- Automated verification where possible.

---

## `infrastructure/compiler-worker`

Proposed isolated ARM compilation worker.

Expected content:

- Container definition.
- Toolchain version declaration.
- Build scripts.
- Resource-limit configuration.
- Input validation.
- Output validation.
- Cleanup logic.
- Security tests.

The worker must not have unrestricted network access.

---

## `infrastructure/simulation-worker`

Proposed isolated firmware-execution worker.

Expected content:

- Renode runtime image.
- Platform setup.
- Session-control scripts.
- Resource-limit configuration.
- Timeout enforcement.
- Cleanup logic.
- Security tests.

Each user session must be isolated from other sessions.

---

## `infrastructure/ci`

Proposed CI configuration and scripts.

Expected responsibilities:

- Documentation validation.
- Type checking.
- Unit tests.
- Firmware fixture compilation.
- Renode integration tests.
- Security checks.
- Selected end-to-end tests.
- Artifact collection.

---

## `examples`

User-facing example projects.

Examples should only be added after the required simulator behavior is implemented and verified.

A planned example must not be presented as runnable before its dependencies exist.

---

## `tests`

Cross-component tests that do not belong to one specific package.

Possible future categories:

```text
tests/
├── integration/
├── end-to-end/
├── security/
└── compatibility/
```

---

# Repository Rules

## One Responsibility per Directory

Each directory should have a clear responsibility.

Avoid placing unrelated code in shared folders.

---

## No Hidden Hardware Logic

TM4C123 register behavior must remain inside approved simulator peripheral models.

It must not be duplicated in:

- React components.
- Browser state.
- Backend API handlers.
- Diagram parsers.
- Test-only production code.

---

## No Generated Artifacts in Git

Do not commit:

- Compiled ELF files unless approved as fixtures.
- Temporary build directories.
- Dependency folders.
- Runtime session files.
- Large logs.
- Local environment files.
- Secrets or credentials.

Generated files should be reproduced through documented commands.

---

## Small Pull Requests

A pull request should normally modify only the files needed for one approved task.

Large repository restructuring requires a separate architecture decision and maintainer approval.

---

## Documentation Must Match Reality

Repository documentation must clearly distinguish between:

- Implemented.
- Tested.
- Proposed.
- Planned.
- Blocked.
- Unsupported.

A planned folder or feature must not be described as currently operational.

---

## Structure Approval

The proposed implementation structure becomes active only after:

1. `RISK-001` is completed.
2. The execution engine is selected.
3. The first vertical slice is proven.
4. The relevant architecture decisions are updated.
5. A project-foundation task is approved.

Until then, the repository remains primarily a planning and feasibility repository.
