# TM4C123 Educational Web Simulator

> **Project status: Planning / Temporarily Paused**  
> This repository does **not** currently contain a finished or usable simulator.

## Overview

This project aims to build a browser-based educational simulator for the **TM4C123G LaunchPad**, inspired by the workflow of tools such as Wokwi.

The long-term goal is to allow students to:

- Write normal TM4C123 C code.
- Compile Cortex-M4 firmware.
- Run the generated firmware in a simulated environment.
- Interact with a virtual TM4C123 LaunchPad.
- Connect components such as LEDs, pushbuttons, resistors, an LCD1602, a potentiometer, and a logic analyzer.
- Observe register-level GPIO, interrupt, timer, SysTick, and ADC behavior.

The project is intentionally focused on university laboratory examples rather than full TM4C123 or full Wokwi compatibility.

---

## Important Notice

This repository is currently in the **architecture, planning, and feasibility stage**.

It is not a finished application, and the simulator cannot currently be run.

The existing files mainly document:

- MVP scope.
- Supported laboratory examples.
- Required registers and peripherals.
- Proposed system architecture.
- Feasibility and execution plans.
- Small implementation tasks and acceptance criteria.

The repository is public to make the design transparent and to invite technical collaboration, not to present the project as complete.

---

## Why Development Is Paused

The next phase requires a suitable development and execution environment for:

- Docker-based isolation.
- ARM Cortex-M4 cross-compilation.
- `arm-none-eabi-gcc`.
- Renode or another suitable execution engine.
- Custom TM4C123 peripheral models.
- Automated testing and CI.
- Adequate storage, memory, and processing capacity.

Development is temporarily paused while a more suitable environment and additional technical support are arranged.

---

## Help Wanted

Technical contributors are welcome.

The project would benefit most from help in the following areas:

- ARM Cortex-M4 and bare-metal firmware.
- TM4C123 register-level peripherals.
- Renode platform and C# peripheral development.
- Embedded toolchains and ELF loading.
- Docker sandboxing and secure execution of user code.
- React and TypeScript frontend development.
- WebSocket or event-stream architecture.
- Digital circuit and pin-state modeling.
- Automated testing and CI/CD.
- Compute, storage, or CI-runner resources suitable for the feasibility spike.
- Technical review of the current architecture and execution plan.

Contributions do not need to cover the whole simulator. The implementation plan is intentionally divided into small, independently testable tasks.

---

## Planned MVP Components

- TM4C123G LaunchPad board.
- Built-in RGB LED.
- SW1 and SW2.
- External LED.
- Pushbutton.
- Resistor.
- Potentiometer.
- LCD1602.
- Logic analyzer.

---

## Planned Code Support

The MVP is intended to support selected educational examples involving:

- GPIO input and output.
- PF0 unlock and commit control.
- GPIO interrupts.
- SysTick.
- NVIC interrupt dispatch.
- General-purpose timers.
- LCD1602 in 4-bit mode.
- ADC0 Sample Sequencer 3.
- Potentiometer-based analog input.
- Digital signal capture.

---

## Target Execution Flow

```text
User C source
→ ARM Cortex-M4 compilation
→ ELF firmware
→ CPU execution
→ TM4C123 MMIO/register models
→ simulated pins and components
→ browser visualization
```

A visual result must come from real firmware execution and simulated register behavior. The UI must not fake MCU outputs.

---

## Current Repository Contents

The repository currently contains project documentation such as:

- MVP specification.
- Compatibility matrix.
- Architecture design.
- Feasibility-spike plan.
- Small task definitions.
- Acceptance criteria and stage gates.

Implementation code will be added only after the initial execution feasibility path is proven.

---

## First Technical Milestone

The first required end-to-end proof is:

```text
C program
→ Cortex-M4 ELF
→ execution engine
→ SYSCTL/GPIOF MMIO writes
→ effective PF1 output
→ red LED state in the browser
```

No large UI implementation should begin before this path is validated.

---

## Contributing

Before contributing:

1. Read the documents inside `docs/`.
2. Choose one small task with a defined scope.
3. Avoid broad or unrelated refactoring.
4. Include tests and exact execution results.
5. Do not claim unsupported functionality is working.
6. Keep implementation decisions consistent with the approved architecture.

For collaboration, open a GitHub Issue describing:

- Your area of expertise.
- The task you want to help with.
- Your proposed approach.
- Any technical requirements or blockers.

---

## Project Principles

- Correctness before visual polish.
- Small and reviewable tasks.
- Real firmware execution.
- Register-level behavior.
- No silent unsupported features.
- Deterministic simulation.
- Clear acceptance tests.
- Honest project status.

---

## Disclaimer

This is an independent educational project.

It is not affiliated with Texas Instruments, Wokwi, Renode, or any university.

Product names and trademarks belong to their respective owners.

---

## Status Summary

| Area | Status |
|---|---|
| Scope and requirements | Documented |
| Compatibility matrix | Documented |
| Architecture | Documented |
| Feasibility plan | Documented |
| Development environment | Not yet provisioned |
| Compiler integration | Not implemented |
| Cortex-M4 execution | Not implemented |
| TM4C123 peripherals | Not implemented |
| Web simulator UI | Not implemented |
| Usable release | Not available |
