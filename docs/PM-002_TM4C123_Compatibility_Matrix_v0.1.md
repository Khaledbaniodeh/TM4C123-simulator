TM4C123 Simulator — PM-002 Compatibility Matrix

Document ID: PM-002Version: 0.1Status: Draft for approvalParent document: TM4C123 Simulator MVP Specification v0.1

1. Purpose

This document maps every mandatory laboratory example to the exact simulator capabilities it requires.

It prevents the project from reaching implementation and later discovering that a required register, interrupt source, pin, peripheral, or component was omitted.

A feature is considered supported only when the complete path works:

User C code
→ Cortex-M4 execution
→ MMIO/register behavior
→ peripheral behavior
→ board/component output
→ acceptance test

2. Support Levels

Level

Meaning

MVP Mandatory

Required before the first MVP can be accepted

MVP Supporting

Required because another mandatory example depends on it

Post-MVP

Explicitly deferred until the mandatory examples are stable

Unsupported

Outside the current project scope

3. Global Dependencies

All code examples depend on the following shared capabilities:

Capability

Minimum requirement

Support level

Cortex-M4 execution

Execute compiled Thumb/Thumb-2 firmware

MVP Mandatory

ELF loading

Load Flash sections, vector table, entry point, and symbols where available

MVP Mandatory

Flash

0x00000000–0x0003FFFF

MVP Supporting

SRAM

0x20000000–0x20007FFF

MVP Supporting

MMIO routing

Route peripheral reads/writes to modeled blocks

MVP Mandatory

Vector table

Initial stack pointer and exception-handler addresses

MVP Mandatory

Reset behavior

Reset CPU, RAM/peripherals as defined, then enter Reset_Handler

MVP Mandatory

Unsupported-access reporting

No silent success for unsupported MMIO

MVP Mandatory

Virtual simulation time

Deterministic timing for SysTick, GPTM, ADC, and logic analyzer

MVP Mandatory

Run controls

Run, pause, stop, reset

MVP Mandatory

4. Compatibility Matrix

EX-001 — GPIOF Red LED Output

Target behavior

The user enables Port F, configures PF1 as a digital output, writes HIGH, and the onboard red LED turns on.

Required pins

Signal

Pin

Red onboard LED

PF1

Required peripherals

System Control

GPIO Port F

Onboard RGB LED model

Required registers

Block

Register

Required behavior

SYSCTL

RCGCGPIO

Bit 5 enables Port F

SYSCTL

PRGPIO

Port-ready behavior where code polls readiness

GPIOF

DIR

Bit 1 selects output

GPIOF

DEN

Bit 1 enables digital operation

GPIOF

DATA

Full and masked-address access

Effective LED rule

Red LED ON =
Port F clock enabled
AND PF1 configured as output
AND PF1 digital enabled
AND PF1 DATA high

Acceptance test

Valid initialization + PF1 HIGH → red LED ON.

PF1 DATA high without clock → LED OFF.

PF1 DATA high without DIR → LED OFF.

PF1 DATA high without DEN → LED OFF.

Priority

MVP Mandatory — first vertical slice

EX-002 — RGB LED Color Output

Target behavior

PF1, PF2, and PF3 independently control the onboard red, blue, and green channels.

Required pins

Color

Pin

Red

PF1

Blue

PF2

Green

PF3

Required registers

Same GPIO/SYSCTL support as EX-001.

Required output combinations

GPIOF bits

Expected color

0x02

Red

0x04

Blue

0x08

Green

0x06

Magenta

0x0A

Yellow

0x0C

Cyan

0x0E

White

Acceptance test

Every supported bit combination updates the visual RGB LED without direct UI state injection.

Priority

MVP Mandatory

EX-003 — SW1 Polling

Target behavior

The user configures PF4 as an input with an internal pull-up and polls its state.

Required pins

Signal

Pin

Electrical behavior

SW1

PF4

Active low

Required registers

Block

Register

Required behavior

SYSCTL

RCGCGPIO

Enable Port F

GPIOF

DIR

PF4 input

GPIOF

DEN

PF4 digital enable

GPIOF

PUR

Internal pull-up

GPIOF

DATA

Read pin state

Button state

Released → PF4 HIGH
Pressed  → PF4 LOW

Acceptance test

A polling program turns an LED on/off based on SW1, using the value read from GPIOF rather than a UI shortcut.

Priority

MVP Mandatory

EX-004 — SW2 Polling and PF0 Unlock

Target behavior

The program unlocks PF0, commits its configuration, enables pull-up/digital input, and reads SW2.

Required pins

Signal

Pin

Electrical behavior

SW2

PF0

Active low, locked after reset

Required registers

Block

Register

Required behavior

GPIOF

LOCK

Accept unlock key

GPIOF

CR

Commit PF0 configuration

GPIOF

DIR

PF0 input

GPIOF

DEN

PF0 digital enable

GPIOF

PUR

PF0 pull-up

GPIOF

DATA

Read PF0

Required key

0x4C4F434B

Acceptance test

PF0 protected configuration writes fail before unlock/commit.

Correct key + CR bit 0 permits configuration.

Released SW2 reads HIGH.

Pressed SW2 reads LOW.

Priority

MVP Mandatory

EX-005 — Software Debouncing with Millisecond Counter

Target behavior

A SysTick-based millisecond counter prevents repeated button actions inside a debounce interval.

Required dependencies

EX-003 SW1 input

EX-007 SysTick periodic interrupt

Global writable SRAM

Deterministic virtual time

Required behavior

SysTick_Handler increments a global millisecond counter.

Button handling compares current time with the previous accepted event.

A configured debounce interval such as 150 ms is respected.

Acceptance test

Multiple electrical transitions or repeated input events inside the debounce interval cause one accepted button action.

Priority

MVP Mandatory

Note

Physical bounce generation is optional at first. The simulator must still execute software debounce code correctly. Deterministic synthetic bounce may be added later.

EX-006 — GPIOF Edge Interrupt

Target behavior

A falling edge on SW1 or SW2 sets GPIO interrupt state and invokes GPIOF_Handler.

Required registers

Block

Register

Required behavior

GPIOF

IS

Edge/level selection

GPIOF

IBE

Both-edge selection

GPIOF

IEV

Rising/falling edge selection

GPIOF

IM

Interrupt mask

GPIOF

RIS

Raw interrupt status

GPIOF

MIS

Masked interrupt status

GPIOF

ICR

Clear latched interrupt

NVIC

ISER

Enable GPIOF interrupt line

Required CPU behavior

Exception entry.

Vector lookup.

Stack frame creation/restoration.

Return from interrupt.

Correct handler dispatch.

Required interrupt number

The exact GPIOF IRQ mapping must be verified against the official TM4C123 device documentation before implementation.

Acceptance test

Valid falling edge + GPIOF/NVIC enabled → handler executes.

Masked interrupt does not execute handler.

Writing the relevant bit to ICR clears the condition.

The ISR does not continuously retrigger after a correct clear.

Priority

MVP Mandatory

EX-007 — SysTick Periodic Interrupt

Target behavior

SysTick periodically calls SysTick_Handler, which toggles an LED or increments a software counter.

Required registers

Register

Required behavior

SysTick->CTRL

Enable, interrupt enable, clock source, COUNTFLAG

SysTick->LOAD

24-bit reload value

SysTick->VAL

Current-value reset/read behavior

Required CPU behavior

SysTick exception dispatch.

Interrupt preemption rules sufficient for MVP examples.

Exception return.

Timing requirement

The simulator must convert configured clock/reload values into deterministic virtual time.

Acceptance test

A program toggling PF3 in SysTick_Handler produces a periodic green LED waveform and matching logic-analyzer transitions.

Priority

MVP Mandatory

EX-008 — SysTick Delay Loop

Target behavior

The LCD driver and other examples use SysTick or a millisecond counter to implement delays.

Required behavior

Current-value decrement.

Reload.

COUNTFLAG behavior.

Polling loops must progress without freezing the entire simulation host.

Pause/reset must remain functional during firmware delay loops.

Acceptance test

A known delay function returns after the expected virtual interval within the accepted timing tolerance.

Priority

MVP Supporting

EX-009 — TIMER0A Periodic Interrupt

Target behavior

Timer 0A periodically toggles PF1, such as every 250 ms.

Required registers

Register

Required behavior

RCGCTIMER

Clock gate Timer 0

CFG

Timer configuration

TAMR

Periodic countdown mode

CTL

Timer A enable

TAILR

Interval load

TAPR

Prescaler where used

IMR

Timeout interrupt mask

RIS

Raw status

MIS

Masked status

ICR

Timeout clear

NVIC enable

Timer 0A interrupt

Acceptance test

PF1 toggles at the programmed period and the interrupt flag clears correctly.

Priority

MVP Mandatory

EX-010 — TIMER1A and TIMER2A Independent Periods

Target behavior

Three independent timers drive three RGB LED channels:

TIMER0A → PF1 every 250 ms
TIMER1A → PF2 every 500 ms
TIMER2A → PF3 every 1000 ms

Required behavior

Independent register state.

Independent pending interrupts.

Deterministic scheduling when interrupts become pending together.

No timer state leaking into another timer.

Acceptance test

The logic analyzer shows three independent periodic signals with approximately 1:2:4 timing ratios.

Priority

MVP Mandatory

EX-011 — LCD1602 Initialization in 4-Bit Mode

Target behavior

The user program initializes an HD44780-compatible LCD through GPIO Port B.

Required pins

LCD signal

TM4C pin

RS

PB0

RW

PB1 or tied to ground

E

PB2

D4

PB4

D5

PB5

D6

PB6

D7

PB7

Required peripherals

SYSCTL

GPIO Port B

HD44780 LCD model

Digital connection graph

Delay/timing support

Required GPIO registers

RCGCGPIO

DIR

DEN

DATA

Required LCD protocol behavior

Enable-edge sampling.

High-nibble then low-nibble assembly.

Command/data selection through RS.

Read/write selection through RW.

Initialization sequence handling.

Required commands

0x01 Clear display

0x02 Return home

0x06 Entry mode

0x0C Display on

0x18 Shift left

0x1C Shift right

0x28 4-bit, 2-line mode

0x80 Line 1 addressing

0xC0 Line 2 addressing

Acceptance test

The supplied driver initializes the display and prints program-generated text such as:

ENCS4110 Lab

Priority

MVP Mandatory

EX-012 — LCD Cursor and Display Shifting

Target behavior

The program moves the cursor or shifts displayed text through valid HD44780 commands.

Required LCD state

DDRAM addresses.

Cursor location.

Entry mode.

Display shift offset.

Two visible lines of 16 characters.

Acceptance test

Cursor positioning and left/right shifting match the commands emitted by the executed program.

Priority

MVP Mandatory if present in the supplied lab example; otherwise MVP Supporting

EX-013 — ADC0 SS3 Polling on PE3/AIN0

Target behavior

The potentiometer drives PE3/AIN0. The program starts a conversion through ADC0 Sample Sequencer 3 and reads the 12-bit result.

Required pins

Signal

Pin

Analog input

PE3 / AIN0

Required components

sim-potentiometer

Analog connection abstraction

GPIO Port E

ADC0 SS3 model

Required registers

Block

Register

Required behavior

SYSCTL

RCGCGPIO

Enable Port E

SYSCTL

RCGCADC

Enable ADC0

GPIOE

AFSEL

Alternate function

GPIOE

DEN

Digital disable for PE3

GPIOE

AMSEL

Analog mode

ADC0

ACTSS

Disable/enable SS3 during configuration

ADC0

EMUX

Software trigger mode

ADC0

SSMUX3

Select AIN0

ADC0

SSCTL3

End/interrupt/sample controls

ADC0

PSSI

Start SS3 conversion

ADC0

RIS

Completion status

ADC0

SSFIFO3

12-bit sample result

ADC0

ISC

Clear completion

Required analog mapping

Potentiometer 0%   → approximately 0
Potentiometer 50%  → approximately 2048
Potentiometer 100% → approximately 4095

Acceptance test

A threshold example controls PF3 according to whether the ADC result is below or above 2048.

Priority

MVP Mandatory

EX-014 — ADC0 SS3 Interrupt

Target behavior

An ADC conversion sets the SS3 interrupt condition and invokes ADC0SS3_Handler.

Additional required registers

ADC0->IM

ADC0 SS3 interrupt status/clear behavior

NVIC enable for ADC0 SS3

Required CPU behavior

Same exception/ISR requirements as GPIO and timer interrupts.

Acceptance test

Completed enabled conversion invokes the handler.

Masked conversion does not invoke it.

Correct ISC write clears the condition.

FIFO returns the expected sample.

Priority

MVP Mandatory

EX-015 — ADC Internal Temperature Sensor

Target behavior

ADC SS3 samples the TM4C internal temperature-sensor source.

Required ADC behavior

Temperature-sensor select bit in SSCTL3.

Deterministic simulated temperature input.

Conversion to a valid ADC sample.

Acceptance test

A fixed configured virtual temperature yields a stable documented ADC value and triggers the expected handler flow.

Priority

Post-MVP unless the instructor explicitly requires this exact example

Reason

The external PE3/AIN0 potentiometer path validates the ADC engine first. Temperature conversion adds a device-specific analog model that is not needed to prove external ADC input.

EX-016 — External LED

Target behavior

A sim-led connected to a valid digital output follows the pin's effective electrical state.

Required part pins

A

C

Required electrical behavior

Correct polarity.

Digital high/low propagation through the connection graph.

Optional glow.

No full current/SPICE calculation required.

Acceptance test

A program-generated GPIO transition changes the external LED only when it is correctly connected and oriented.

Priority

MVP Mandatory

EX-017 — External Pushbutton

Target behavior

A sim-pushbutton changes the connected digital net while pressed.

Required pins

1.l

1.r

2.l

2.r

Required electrical behavior

Same-side terminals internally connected.

Opposite contacts connect while pressed.

Mouse press/release.

Optional keyboard shortcut.

Optional deterministic bounce.

Acceptance test

A polling or interrupt example reads the actual connected net transition.

Priority

MVP Mandatory

EX-018 — Resistor Pull-Up/Pull-Down

Target behavior

A resistor may provide a logical pull-up or pull-down in supported digital circuits.

Required behavior

Value attribute stored/displayed.

Detect supported pull-up/pull-down topology.

No full Kirchhoff/SPICE solver.

Acceptance test

A floating input resolves according to a valid supported resistor-to-power or resistor-to-ground connection.

Priority

MVP Supporting

EX-019 — Potentiometer

Target behavior

The user changes a position from 0.0 to 1.0 and the connected ADC input changes accordingly.

Required pins

GND

SIG

VCC

Acceptance test

Moving the control produces a monotonic ADC result across the expected 0–4095 range.

Priority

MVP Mandatory

EX-020 — Logic Analyzer

Target behavior

The analyzer records digital transitions generated by executed firmware.

Required capabilities

Connect channels to digital nets.

Subscribe to signal transitions.

Record Renode/simulator virtual timestamps.

Render HIGH/LOW waveforms.

Start, pause, clear, and reset capture.

Preserve timing relationships across channels.

Acceptance tests

SysTick-driven PF3 blink creates a matching waveform.

TIMER0A/TIMER1A/TIMER2A outputs show independent periods.

Pressing a button creates an input transition at the correct virtual timestamp.

Priority

MVP Mandatory

5. Register Coverage Matrix

Register/block

EX-001

EX-003

EX-004

EX-006

EX-007

EX-009/10

EX-011

EX-013

EX-014

SYSCTL RCGCGPIO

✓

✓

✓

✓





✓

✓

✓

SYSCTL PRGPIO

Optional

Optional

Optional

Optional





Optional

Optional

Optional

SYSCTL RCGCTIMER











✓







SYSCTL RCGCADC















✓

✓

GPIO DATA

✓

✓

✓

✓

✓

✓

✓

✓

✓

GPIO DIR

✓

✓

✓

✓





✓

✓

✓

GPIO DEN

✓

✓

✓

✓





✓

✓

✓

GPIO PUR



✓

✓

✓











GPIO LOCK/CR





✓

✓ for PF0











GPIO IS/IBE/IEV







✓











GPIO IM/RIS/MIS/ICR







✓











GPIO AFSEL/AMSEL















✓

✓

SysTick









✓



Delay dependency





NVIC







✓

✓

✓





✓

GPTM











✓







ADC0 SS3















✓

✓

6. Implementation Dependency Order

Cortex-M4 + ELF + MMIO
        ↓
SYSCTL + GPIOF basic output
        ↓
PF1/PF2/PF3 onboard RGB LED
        ↓
PF4 polling
        ↓
PF0 LOCK/CR + SW2
        ↓
NVIC + GPIO interrupts
        ↓
SysTick + virtual time
        ↓
GPTM timers
        ↓
GPIOB + digital nets
        ↓
LCD1602 HD44780 model
        ↓
GPIOE + analog nets
        ↓
ADC0 SS3
        ↓
Logic analyzer

7. Explicit Non-Requirements

The examples in this matrix do not require:

Full floating-point/FPU simulation validation.

USB device/host emulation.

UART, I2C, SSI/SPI, CAN, Ethernet, DMA, QEI, or PWM.

Full circuit-current calculation.

Full analog/SPICE simulation.

Source-level debugging.

Complete TM4C123 register coverage.

Support for arbitrary Cortex-M boards.

These features must not be added to an implementation task unless a later approved specification changes the scope.

8. Open Verification Items

The following exact facts must be verified from the official TM4C123 device documentation before the corresponding implementation task begins:

GPIOF interrupt number and NVIC bit.

TIMER0A, TIMER1A, and TIMER2A interrupt numbers.

ADC0 SS3 interrupt number.

Complete register offsets and reset values for GPTM.

Complete ADC0 SS3 register offsets, masks, and reset values.

Exact PRGPIO, RCGCTIMER, and RCGCADC addresses.

Any clock/readiness delays required by the supplied code examples.

Exact behavior of masked GPIO DATA accesses.

Exact SysTick COUNTFLAG read/clear behavior as required by the code.

Exact LCD timing tolerance to enforce in the educational model.

No implementation task may guess these values.

9. Approval Gate

PM-002 is approved when:

Every mandatory code example has a row or section.

Every example lists required pins, registers, peripherals, and acceptance behavior.

Dependencies are explicit.

Deferred features are clearly marked.

No unsupported feature is required by a mandatory example.

The technical manager approves the open verification list.

After approval, the next document is:

PM-003 — Architecture Design
