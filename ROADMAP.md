# Project Roadmap

This roadmap is organized around small, verifiable stage gates.

## Phase 0 — Planning and Risk Reduction

- [x] Define MVP scope.
- [x] Define supported components.
- [x] Define supported laboratory examples.
- [x] Define required registers and peripherals.
- [x] Define architecture.
- [x] Define RISK-001 feasibility spike.
- [ ] Provision a suitable implementation environment.
- [ ] Pin compiler and execution-engine versions.
- [ ] Complete the first end-to-end feasibility proof.

## Phase 1 — Project Foundation

- [ ] Create repository workspace structure.
- [ ] Configure React and TypeScript.
- [ ] Configure tests, linting, and type checking.
- [ ] Define shared runtime contracts.
- [ ] Define `diagram.json` schema.
- [ ] Implement parser and validator.
- [ ] Implement part registry.

## Phase 2 — Board and Workspace

- [ ] Create TM4C123 LaunchPad board renderer.
- [ ] Add J1, J2, J3, and J4 pin mappings.
- [ ] Add interactive pin tooltips.
- [ ] Add pan and zoom.
- [ ] Add part movement and rotation.

## Phase 3 — Components and Connections

- [ ] LED.
- [ ] Pushbutton.
- [ ] Resistor.
- [ ] Potentiometer.
- [ ] LCD1602 renderer.
- [ ] Logic-analyzer renderer.
- [ ] Wire renderer.
- [ ] Digital net graph.

## Phase 4 — Core TM4C123 Behavior

- [ ] Memory and MMIO routing.
- [ ] System Control clock gating.
- [ ] GPIO Ports A–F.
- [ ] Built-in RGB LED.
- [ ] SW1 and SW2.
- [ ] PF0 lock and commit behavior.

## Phase 5 — Interrupts and Timing

- [ ] NVIC integration.
- [ ] GPIO interrupts.
- [ ] SysTick.
- [ ] TIMER0A.
- [ ] TIMER1A.
- [ ] TIMER2A.

## Phase 6 — LCD1602

- [ ] HD44780 state model.
- [ ] 4-bit protocol.
- [ ] Command processing.
- [ ] DDRAM and cursor.
- [ ] Browser rendering.

## Phase 7 — ADC

- [ ] ADC0 Sample Sequencer 3.
- [ ] PE3/AIN0 input.
- [ ] Potentiometer integration.
- [ ] Polling conversions.
- [ ] Interrupt-driven conversions.

## Phase 8 — Logic Analyzer

- [ ] Pin subscriptions.
- [ ] Virtual timestamps.
- [ ] Digital waveform rendering.
- [ ] Capture controls.
- [ ] Bounded buffering.

## Phase 9 — Complete User Workflow

- [ ] C code editor.
- [ ] Compile.
- [ ] Run.
- [ ] Pause.
- [ ] Reset.
- [ ] Error console.
- [ ] Save and load project.
- [ ] Automated end-to-end examples.

## MVP Completion Condition

The MVP is complete only when real compiled user C code drives simulated TM4C123 register behavior and visible components.
