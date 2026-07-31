# Test Strategy

This document defines the planned testing approach for the TM4C123 Educational Web Simulator.

The purpose of testing is not only to confirm that the web interface works. The project must prove that compiled firmware produces correct and deterministic simulated hardware behavior.

---

## Current Status

The project is currently in the planning and feasibility stage.

Most tests described in this document are therefore planned rather than implemented.

No test should be marked as passing unless:

- The relevant implementation exists.
- The documented command was executed.
- The result was recorded.
- The expected behavior was actually observed.
- Any limitations were reported honestly.

---

## Testing Objectives

The test strategy must verify that:

1. User C source can be compiled safely.
2. The compiler produces valid Cortex-M4 firmware.
3. ELF firmware can be loaded by the execution engine.
4. Cortex-M4 instructions are executed rather than replaced by frontend behavior.
5. TM4C123 memory-mapped registers behave as documented.
6. Peripheral state produces correct pin-level behavior.
7. Components react to simulated pin and analog states.
8. Browser output matches execution-engine events.
9. Simulation timing is deterministic.
10. Unsupported behavior fails clearly.
11. Untrusted user code is isolated.
12. Repeated sessions do not leak data or state.

---

## Testing Principles

### Real Execution

Tests must verify actual firmware execution.

A test is not valid if the expected LED, LCD, timer, or ADC result is directly hardcoded into the frontend.

---

### Small and Focused Tests

Each test should verify one behavior whenever practical.

Examples:

- Enabling the GPIOF clock.
- Configuring PF1 as an output.
- Unlocking PF0.
- Clearing a GPIO interrupt.
- Triggering one SysTick interrupt.
- Reading one ADC0 SS3 sample.

---

### Deterministic Results

The same:

```text
Firmware
Initial state
Input sequence
Simulation configuration
```

must produce the same:

```text
Register values
Interrupt order
Pin transitions
Virtual timestamps
Component output
```

---

### Evidence-Based Completion

A task is not complete only because code was written.

Required evidence may include:

- Test command.
- Exit code.
- Test output.
- Register trace.
- Runtime event trace.
- Screenshot.
- Logic-analyzer waveform.
- Compiled ELF metadata.
- Known limitations.

---

### Clear Unsupported Behavior

Unsupported registers, modes, pins, commands, or components must not be silently accepted.

Depending on the interface, unsupported behavior should produce:

- A validation error.
- A structured runtime warning.
- A documented unsupported-access event.
- A controlled simulation failure.

---

# Test Levels

## 1. Documentation Tests

Documentation tests verify that repository information remains consistent and usable.

Planned checks include:

- Required files exist.
- Internal Markdown links are valid.
- Referenced task IDs exist.
- Documented filenames match repository filenames.
- Status statements do not contradict each other.
- Planned behavior is not described as implemented.
- Code examples use valid formatting.
- Tables render correctly.
- Issue and pull request templates contain valid front matter.

Documentation checks should run in CI before implementation tests.

---

## 2. Static Analysis

Static analysis should run before unit and integration tests.

Planned checks include:

### TypeScript

- Type checking.
- Linting.
- Formatting validation.
- Unused-code detection where practical.
- Dependency checks.

### C#

- Build validation.
- Static-analysis warnings.
- Nullable-reference checks.
- Formatting validation.

### C Firmware Fixtures

- Compiler warnings.
- Linker warnings.
- Section-placement verification.
- Vector-table verification.
- Disassembly inspection where required.

Warnings should not be ignored without a documented reason.

---

## 3. Unit Tests

Unit tests verify small isolated modules.

Planned unit-test areas include:

- Protocol validation.
- `diagram.json` parsing.
- Pin-name resolution.
- Digital-state resolution.
- Analog-input conversion.
- Register-field behavior.
- Error mapping.
- Runtime-event serialization.
- Session-state transitions.
- Resource-limit validation.

External services and full simulation workers should not be required for most unit tests.

---

## 4. Firmware Build Tests

Firmware build tests verify that approved source fixtures compile correctly.

Each fixture should contain:

```text
main.c
startup.s or startup.c
linker.ld
build instructions
expected result
```

Planned checks include:

- Successful Cortex-M4 compilation.
- Correct target architecture.
- Correct entry point.
- Valid vector table.
- Flash sections inside the supported Flash range.
- SRAM sections inside the supported SRAM range.
- No unexpected host architecture output.
- Bounded firmware artifact size.
- Useful compiler errors for invalid source.

Useful inspection tools may include:

```text
arm-none-eabi-gcc
arm-none-eabi-readelf
arm-none-eabi-objdump
arm-none-eabi-size
```

---

## 5. Compiler Worker Tests

The compiler worker will process untrusted user-provided source code.

It must be tested for correctness and isolation.

### Functional Tests

- Compile valid firmware.
- Return ELF output.
- Return compiler diagnostics.
- Reject missing source files.
- Reject oversized input.
- Reject unsupported build options.
- Handle syntax errors.
- Handle linker errors.
- Clean temporary directories.

### Isolation Tests

- No outbound network access.
- No host filesystem access.
- No access to other sessions.
- CPU limit enforced.
- Memory limit enforced.
- Process limit enforced.
- Wall-clock timeout enforced.
- Output-size limit enforced.
- Cleanup occurs after failure.
- Cleanup occurs after timeout.

---

## 6. Execution-Engine Tests

Execution-engine tests verify that Cortex-M4 firmware can be loaded and executed.

Planned checks include:

- Load a valid ELF.
- Read the initial stack pointer.
- Read the reset vector.
- Start from the reset handler.
- Execute basic instructions.
- Access Flash.
- Access SRAM.
- Perform MMIO reads and writes.
- Stop at a defined timeout.
- Produce structured runtime output.
- Reset the machine to a known state.

Invalid or unsupported firmware must fail in a controlled way.

---

# Peripheral Testing

## System Control Tests

Initial System Control coverage should verify:

- Reset values.
- GPIO clock-gating writes.
- GPIO clock-ready behavior where modeled.
- Timer clock-gating writes.
- ADC clock-gating writes.
- Unsupported clock fields.
- Peripheral access before clock enable.

Example behavior:

```text
Write bit 5 in RCGCGPIO
→ GPIO Port F becomes clock-enabled
```

---

## GPIO Tests

GPIO tests should verify register behavior independently from the browser.

Planned checks include:

- Reset state.
- Direction register.
- Digital-enable register.
- Pull-up register.
- Alternate-function register.
- Port-control register.
- Data register reads.
- Data register writes.
- Masked data addressing.
- Input values.
- Effective output values.
- Unsupported pins.
- GPIO clock-disabled behavior.

---

## GPIOF Built-In LED Tests

Planned built-in LED tests include:

| Pin | Expected color |
|---|---|
| PF1 | Red |
| PF2 | Blue |
| PF3 | Green |

Tests should verify:

- Individual colors.
- Multiple active channels.
- LED off state.
- Direction misconfiguration.
- Digital-enable misconfiguration.
- GPIO clock disabled.
- Reset behavior.

---

## SW1 and SW2 Tests

Planned button tests include:

| Button | Pin | Electrical behavior |
|---|---|---|
| SW1 | PF4 | Active-low |
| SW2 | PF0 | Active-low |

Tests should verify:

- Released state.
- Pressed state.
- Pull-up configuration.
- Input register value.
- Runtime input events.
- Polling firmware behavior.

---

## PF0 Unlock Tests

PF0 protection must be tested explicitly.

Planned checks include:

- PF0 remains protected after reset.
- Incorrect unlock key is rejected.
- Correct unlock key is accepted.
- Commit register controls protected changes.
- Protected configuration writes are ignored before commit.
- PF0 may be configured after valid unlock and commit.
- Reset restores protection.

The expected unlock key is:

```text
0x4C4F434B
```

---

## GPIO Interrupt Tests

Planned checks include:

- Edge selection.
- Single-edge configuration.
- Both-edge configuration where supported.
- Rising-edge behavior.
- Falling-edge behavior.
- Interrupt mask behavior.
- Raw interrupt status.
- Masked interrupt status.
- Interrupt clearing.
- NVIC enable.
- ISR dispatch.
- Repeated button transitions.
- No interrupt after masking.
- Deterministic interrupt ordering.

---

## SysTick Tests

Planned SysTick coverage includes:

- Reset values.
- Reload register.
- Current-value behavior.
- Enable control.
- Interrupt enable.
- Counter expiration.
- Reload behavior.
- Periodic interrupts.
- ISR dispatch.
- Virtual-time advancement.
- Reset behavior.

A SysTick test should not depend on browser wall-clock timing.

---

## General-Purpose Timer Tests

Initial timer targets are:

```text
TIMER0A
TIMER1A
TIMER2A
```

Planned checks include:

- Clock enable.
- Reset state.
- Timer disable before configuration.
- Periodic mode.
- Interval-load value.
- Counter progression.
- Timeout status.
- Interrupt mask.
- Interrupt clear.
- NVIC dispatch.
- Repeated periodic interrupts.
- Reset behavior.
- Virtual timestamps.

---

## ADC0 SS3 Tests

Initial ADC coverage targets:

```text
ADC0
Sample Sequencer 3
PE3 / AIN0
```

Planned checks include:

- ADC clock enable.
- GPIOE analog configuration.
- Sequencer disable before configuration.
- Channel selection.
- End-of-sequence configuration.
- Sample interrupt configuration.
- Processor-triggered conversion.
- FIFO result.
- Raw interrupt status.
- Interrupt clear.
- NVIC dispatch.
- Polling firmware.
- Interrupt-based firmware.
- Reset behavior.

---

## Analog Conversion Tests

The planned ADC result range is:

```text
0 to 4095
```

Tests should include:

| Input condition | Expected result |
|---|---|
| Minimum input | Near 0 |
| Midpoint input | Near 2048 |
| Maximum input | Near 4095 |

The exact voltage model and rounding rules must be documented before final acceptance.

Values outside the supported analog range should be clamped or rejected according to the approved architecture.

---

## LCD1602 Tests

The planned LCD model is HD44780-compatible in 4-bit mode.

Tests should verify:

- Initialization sequence.
- Command writes.
- Data writes.
- High-nibble and low-nibble assembly.
- Enable-line transitions.
- Register-select behavior.
- Display clear.
- Cursor movement.
- Character output.
- DDRAM addressing.
- Two-line display behavior.
- Reset state.
- Unsupported command handling.

Browser rendering must match the LCD model's internal state.

---

## Digital Net Tests

Planned digital net states include:

```text
LOW
HIGH
FLOATING
CONFLICT
```

Tests should verify:

- One output driving LOW.
- One output driving HIGH.
- Pull-up behavior.
- Floating input.
- Multiple matching drivers.
- Conflicting drivers.
- Button-controlled nets.
- LED-connected nets.
- Net changes after wire removal.
- Reset behavior.

---

## Logic Analyzer Tests

Logic-analyzer tests should verify:

- Signal selection.
- LOW-to-HIGH transitions.
- HIGH-to-LOW transitions.
- Virtual timestamps.
- Multiple channels.
- Stable signal periods.
- Reset and capture restart.
- Maximum sample limits.
- Deterministic repeated captures.
- Browser waveform rendering.

Logic-analyzer samples must originate from simulated signal changes.

---

# Protocol and Session Tests

## Runtime Protocol Tests

Structured messages should be validated for:

- Required fields.
- Event type.
- Session identifier.
- Virtual timestamp.
- Payload schema.
- Protocol version.
- Invalid event rejection.
- Unknown event handling.

Possible event categories include:

```text
compile.started
compile.completed
compile.failed
simulation.started
simulation.paused
simulation.reset
simulation.stopped
gpio.output.changed
button.input.changed
lcd.state.changed
adc.input.changed
logic.sample
runtime.warning
runtime.error
```

The final event names may change before implementation.

---

## Session Lifecycle Tests

Planned session states include:

```text
Created
Compiling
Ready
Running
Paused
Stopped
Failed
Expired
```

Tests should verify valid and invalid transitions.

Examples:

```text
Ready → Running
Running → Paused
Paused → Running
Running → Stopped
```

Invalid transitions should produce a clear error.

Example:

```text
Expired → Running
```

---

## Multi-Session Tests

Tests should confirm that:

- Each session has independent memory.
- Each session has independent peripherals.
- Button input affects only its own session.
- Firmware artifacts are not shared unexpectedly.
- Temporary directories are isolated.
- Events use the correct session identifier.
- Stopping one session does not stop another.
- Expired sessions are cleaned safely.

---

# Frontend Testing

## Component Tests

Planned frontend component tests include:

- Code editor controls.
- Compile button state.
- Run controls.
- Pause control.
- Reset control.
- Stop control.
- LED state rendering.
- Button press and release.
- LCD character rendering.
- Potentiometer value control.
- Runtime error display.
- Unsupported-feature warning.
- Session-state display.

---

## Board Visualization Tests

Tests should verify:

- Correct board image or rendering.
- Correct PF1, PF2, and PF3 LED mapping.
- Correct SW1 and SW2 mapping.
- Accurate pin labels.
- Component selection.
- Zoom and pan where implemented.
- Wire attachment.
- Wire removal.
- Invalid pin rejection.
- State reset after simulation reset.

---

## Accessibility Tests

The browser interface should be tested for:

- Keyboard navigation.
- Visible focus indicators.
- Accessible button labels.
- Alternative text.
- Sufficient text contrast.
- Error messages that do not depend only on color.
- Logical heading order.
- Screen-reader-friendly control names.

---

## Browser Compatibility Tests

The initial supported browser list must be documented before implementation acceptance.

At minimum, testing should consider current desktop versions of:

- Chrome.
- Edge.
- Firefox.

Other browsers should not be claimed as supported until tested.

---

# Integration Tests

Integration tests verify communication between multiple layers.

Planned combinations include:

### Compiler Integration

```text
Source input
→ compiler worker
→ ELF artifact
→ diagnostics
```

### Execution Integration

```text
ELF artifact
→ execution engine
→ CPU reset
→ firmware execution
```

### Peripheral Integration

```text
Firmware MMIO write
→ peripheral register model
→ effective pin state
```

### Component Integration

```text
Effective pin state
→ connected component
→ component-state event
```

### Browser Integration

```text
Runtime event
→ frontend state
→ visual output
```

---

# End-to-End Tests

## First Required End-to-End Test

The first complete end-to-end test must prove:

```text
C source
→ Cortex-M4 compilation
→ ELF firmware
→ execution engine
→ SYSCTL/GPIOF MMIO
→ PF1 output event
→ browser red LED
```

### Required Assertions

- Source compiles successfully.
- ELF targets ARM Cortex-M4.
- Reset handler executes.
- GPIOF clock is enabled.
- PF1 is configured as a digital output.
- PF1 output becomes HIGH.
- A structured GPIO output event is produced.
- The event reaches the correct browser session.
- The red LED becomes visibly active.
- Reset turns the simulated state back to its initial value.
- The frontend does not directly infer the result from source text.

---

## Future End-to-End Scenarios

Planned future scenarios include:

1. RGB LED color changes.
2. SW1 polling.
3. PF0 unlock and SW2 polling.
4. GPIOF button interrupt.
5. SysTick LED toggle.
6. TIMER0A periodic interrupt.
7. LCD1602 text output.
8. Potentiometer to ADC0 SS3.
9. ADC interrupt.
10. Logic-analyzer waveform capture.

Each scenario should have a small reference firmware fixture.

---

# Security Testing

Security testing is mandatory because the system will process and execute user-provided code.

Planned security tests include:

- Malicious source filenames.
- Path traversal.
- Oversized source input.
- Excessive compiler output.
- Infinite compilation process.
- Infinite firmware loop.
- Process spawning.
- Fork or process exhaustion.
- Memory exhaustion.
- Filesystem probing.
- Network connection attempts.
- Environment-variable access.
- Secret-file access.
- Cross-session access.
- Artifact injection.
- Symbolic-link attacks.
- Temporary-directory cleanup.
- Runtime timeout bypass attempts.

Security-test results should not expose sensitive infrastructure details publicly.

See [`../SECURITY.md`](../SECURITY.md) for reporting guidance.

---

# Performance and Resource Tests

Performance testing is not the first priority, but bounded execution is required.

Planned measurements include:

- Compilation duration.
- ELF artifact size.
- Worker startup duration.
- Simulation startup duration.
- Event latency.
- Memory usage per session.
- CPU usage per session.
- Logic-analyzer sample volume.
- Cleanup duration.
- Maximum concurrent sessions.

Performance targets must be based on measured feasibility results rather than assumptions.

---

# Regression Testing

Every fixed bug should receive a regression test when practical.

A regression test should:

1. Fail before the fix.
2. Pass after the fix.
3. Remain in the test suite.
4. Reference the related issue.
5. Avoid depending on unrelated implementation details.

Peripheral fixes should usually include a small register-level or firmware-fixture test.

---

# Test Fixtures

Firmware fixtures should be small and deterministic.

Planned fixture directories may include:

```text
gpiof-red-led/
gpiof-rgb-led/
sw1-polling/
sw2-pf0-unlock/
gpiof-interrupt/
systick-led-toggle/
timer0a-interrupt/
lcd1602-hello/
adc0-ss3-polling/
adc0-ss3-interrupt/
logic-analyzer-square-wave/
```

Each fixture should document:

- Purpose.
- Required peripherals.
- Source files.
- Build command.
- Expected register behavior.
- Expected pin behavior.
- Expected runtime events.
- Expected visible output.
- Known limitations.

---

# Test Naming

Test names should describe behavior rather than implementation details.

Preferred:

```text
gpiof_pf1_output_changes_after_valid_configuration
```

Avoid:

```text
test_gpio_1
```

A useful test name should indicate:

```text
Module
Condition
Expected result
```

---

# Test Evidence

Pull requests that change behavior should include relevant evidence.

Example:

```text
Task: RISK-001
Test: PF1 first vertical slice
Command: npm run test:e2e -- pf1-red-led
Result: PASS
Commit: <commit SHA>
Environment: Linux x86_64
```

For register-level behavior, include relevant traces such as:

```text
RCGCGPIO = 0x20
GPIOFDIR = 0x02
GPIOFDEN = 0x02
GPIOFDATA = 0x02
Effective PF1 = HIGH
```

Do not include secrets, credentials, or private environment information.

---

# CI Test Stages

A future CI pipeline may use the following order:

```text
1. Repository validation
2. Documentation checks
3. Formatting
4. Static analysis
5. Type checking
6. Unit tests
7. Firmware fixture compilation
8. Peripheral tests
9. Integration tests
10. Security checks
11. Selected end-to-end tests
12. Artifact and log collection
```

Fast checks should run before expensive simulation tests.

---

# Pull Request Requirements

A behavior-changing pull request should normally include:

- Related task or issue.
- Tests for the new behavior.
- Exact commands executed.
- Test results.
- Known limitations.
- Security impact.
- Updated documentation where needed.

A pull request must not be approved only because the UI appears correct.

---

# Stage Gates

## Gate 1 — Environment Ready

Required evidence:

- ARM compiler available.
- ELF inspection tools available.
- Execution engine available.
- Isolation method available.
- Adequate storage confirmed.
- Commands recorded.

---

## Gate 2 — Firmware Build Proven

Required evidence:

- Reference C firmware compiles.
- ELF is valid.
- Vector table is valid.
- Flash and SRAM placement is correct.
- Build is reproducible.

---

## Gate 3 — Cortex-M4 Execution Proven

Required evidence:

- ELF loads.
- Reset handler runs.
- Basic instructions execute.
- Flash, SRAM, and MMIO access are observed.
- Execution can be stopped safely.

---

## Gate 4 — GPIOF Peripheral Proven

Required evidence:

- RCGCGPIO behavior works.
- GPIOF configuration works.
- PF1 effective output is produced.
- Reset restores initial state.
- Unsupported access is visible.

---

## Gate 5 — Browser Vertical Slice Proven

Required evidence:

- PF1 runtime event reaches the browser.
- Red LED state changes.
- Session identifiers are correct.
- Reset clears the visual state.
- No frontend shortcut produces the result.

---

# Definition of Tested

A feature may be described as **tested** only when:

- Its implementation exists.
- Automated or reproducible manual tests exist.
- Expected and actual results match.
- The test ran in a documented environment.
- Known limitations are recorded.
- The result can be reviewed by another contributor.

A feature that only has a plan or unexecuted test case must remain labeled:

```text
Planned
Not implemented
Not yet verified
```

---

# Test Strategy Review

This strategy should be updated when:

- The execution engine is selected.
- The compiler-worker design is approved.
- The runtime protocol is defined.
- New peripherals enter MVP scope.
- A supported-browser policy is established.
- Security controls change.
- Performance targets are measured.
- The first vertical slice is completed.
