# Contributing to the TM4C123 Educational Web Simulator

Thank you for your interest in contributing.

This project is currently in the planning and feasibility stage. The simulator is not yet complete, and contributions should follow the documented architecture and small-task workflow.

## Before You Start

Please read:

- `README.md`
- `docs/TM4C123_Simulator_MVP_Specification_v0.1.md`
- `docs/PM-002_TM4C123_Compatibility_Matrix_v0.1.md`
- `docs/PM-003_TM4C123_Architecture_Design_v0.1.md`
- `docs/RISK-001_TM4C123_Feasibility_Spike_Plan_v0.1.md`

## Contribution Workflow

1. Open an issue describing the task you want to work on.
2. Keep the task small and independently testable.
3. Wait for the scope to be confirmed before implementation.
4. Create a focused branch.
5. Implement only the approved task.
6. Add or update tests.
7. Include exact commands and test results in the pull request.
8. Do not mix unrelated refactoring with feature work.

## Required Pull Request Information

Every pull request should include:

- Task ID.
- Objective.
- Files changed.
- What was implemented.
- What was intentionally not implemented.
- Commands executed.
- Test results.
- Known limitations.
- Screenshots or logs when relevant.

## Project Rules

- Do not claim unsupported hardware behavior works.
- Do not fake MCU output from the frontend.
- Do not silently ignore unsupported MMIO access.
- Do not add large dependencies without approval.
- Do not expand the task scope without discussion.
- Keep simulation behavior deterministic.
- Preserve clear boundaries between UI, project model, electrical model, execution engine, and TM4C peripheral models.

## Areas Where Help Is Needed

- ARM Cortex-M4 and bare-metal startup code.
- `arm-none-eabi-gcc` toolchain integration.
- ELF loading.
- Renode platform and C# peripheral development.
- TM4C123 GPIO, SysTick, NVIC, GPTM, and ADC behavior.
- React and TypeScript frontend development.
- Secure compiler and execution sandboxing.
- Automated testing and CI.
- Logic-analyzer and waveform rendering.
- Technical documentation and review.

## Code Quality

A task is complete only when:

- Build succeeds.
- Type checking succeeds.
- Tests succeed.
- No unhandled console errors remain.
- Changes stay inside the approved scope.
- Unsupported behavior is reported clearly.
- The implementation includes an acceptance test.

## Communication

Use GitHub Issues for contribution proposals, architecture questions, technical blockers, requests to claim a task, and environment or CI support offers.
