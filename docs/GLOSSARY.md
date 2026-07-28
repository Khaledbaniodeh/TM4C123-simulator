# Project Glossary

This glossary explains the main technical terms used throughout the TM4C123 Educational Web Simulator documentation.

---

## ADC

**Analog-to-Digital Converter**

A peripheral that converts an analog voltage into a digital numerical value.

The planned MVP uses a 12-bit ADC result:

```text
0 to 4095
```

---

## ADC0 SS3

**ADC0 Sample Sequencer 3**

A simple ADC sample sequencer planned for the MVP.

It will be used primarily with:

```text
PE3 / AIN0
```

and the simulated potentiometer.

---

## AIN0

**Analog Input 0**

The analog channel connected to pin `PE3` on the TM4C123.

---

## ARM Cortex-M4

The processor architecture used by the TM4C123GH6PM microcontroller.

The simulator must execute compiled Cortex-M4 firmware rather than fake program behavior from the frontend.

---

## Bare-Metal Firmware

Embedded software that runs directly on the microcontroller without an operating system.

Typical bare-metal files include:

```text
main.c
startup.s
linker.ld
```

---

## CMSIS

**Cortex Microcontroller Software Interface Standard**

A standardized interface for Cortex-M processors and peripherals.

The project intends to support CMSIS-style register access such as:

```c
GPIOF->DIR |= 0x02;
```

---

## Cortex-M Exception

A hardware-managed event such as:

- Reset.
- SysTick.
- Interrupt.
- Fault.

The processor uses the vector table to locate the correct handler.

---

## DDRAM

**Display Data RAM**

Memory inside an HD44780-compatible LCD controller that stores the characters shown on the LCD1602.

---

## Deterministic Simulation

A simulation where the same:

```text
Firmware
Initial state
Input sequence
```

produces the same output and event order.

---

## Digital Net

A logical electrical connection between two or more pins.

A digital net may resolve to:

```text
LOW
HIGH
FLOATING
CONFLICT
```

---

## ELF

**Executable and Linkable Format**

The planned firmware format produced by the ARM compiler and loaded into the execution engine.

An ELF file may contain:

- Machine code.
- Data sections.
- Entry point.
- Vector table.
- Symbols.
- Debug information.

---

## Execution Engine

The system responsible for executing compiled Cortex-M4 firmware.

Renode is the initial candidate execution engine for the feasibility spike.

---

## GPIO

**General-Purpose Input/Output**

Microcontroller pins that may be configured as digital inputs or outputs.

---

## GPIOF

**GPIO Port F**

A TM4C123 GPIO port containing the LaunchPad's built-in RGB LED and user buttons.

Important pins:

| Pin | Function |
|---|---|
| PF0 | SW2 |
| PF1 | Red LED |
| PF2 | Blue LED |
| PF3 | Green LED |
| PF4 | SW1 |

---

## GPTM

**General-Purpose Timer Module**

A TM4C123 peripheral used for periodic timing and interrupts.

The planned MVP examples use:

```text
TIMER0A
TIMER1A
TIMER2A
```

---

## HD44780

A commonly used LCD controller interface.

The planned LCD1602 component will emulate the HD44780 command and data protocol in 4-bit mode.

---

## ISR

**Interrupt Service Routine**

A function executed when an interrupt occurs.

Examples:

```c
void GPIOF_Handler(void);
void SysTick_Handler(void);
void ADC0SS3_Handler(void);
```

---

## Linker Script

A file that controls where firmware sections are placed in Flash and SRAM.

The planned linker script file is:

```text
linker.ld
```

---

## Logic Analyzer

A tool that records digital signal transitions over time.

The simulated logic analyzer will display GPIO HIGH and LOW waveforms using simulation virtual timestamps.

---

## MMIO

**Memory-Mapped Input/Output**

A method where peripheral registers are accessed through addresses in the processor memory map.

Example:

```text
GPIOF DATA = 0x400253FC
```

---

## NVIC

**Nested Vectored Interrupt Controller**

The Cortex-M interrupt controller responsible for enabling, pending, prioritizing, and dispatching interrupts.

---

## PF0 Unlock

PF0 is protected after reset because it may be used as an NMI pin.

The firmware must write the unlock key:

```text
0x4C4F434B
```

and configure the GPIO commit register before changing protected PF0 settings.

---

## Peripheral Model

A software implementation of a hardware peripheral's register behavior.

Examples planned for this project:

- System Control.
- GPIO.
- SysTick.
- GPTM.
- ADC0 SS3.

---

## RCGCGPIO

**Run Mode Clock Gating Control for GPIO**

A System Control register used to enable GPIO port clocks.

Known address:

```text
0x400FE608
```

Bit 5 enables GPIO Port F.

---

## Renode

An open-source simulation framework for embedded systems.

It is the initial execution-engine candidate for the project's feasibility spike.

The final decision remains dependent on the successful completion of `RISK-001`.

---

## Reset Handler

The first firmware function executed after reset.

It typically:

1. Initializes `.data`.
2. Clears `.bss`.
3. Calls `main`.
4. Enters a safe loop if `main` returns.

---

## RISK-001

The feasibility spike that must prove:

```text
C source
→ Cortex-M4 ELF
→ execution engine
→ TM4C123 MMIO
→ PF1 output
→ browser LED
```

---

## SRAM

**Static Random-Access Memory**

The runtime memory used for variables, stack, `.data`, and `.bss`.

Planned TM4C123 SRAM range:

```text
0x20000000 to 0x20007FFF
```

---

## SysTick

A Cortex-M system timer commonly used for:

- Periodic interrupts.
- Millisecond counters.
- Delays.
- Scheduling.

---

## TM4C123GH6PM

The microcontroller used on the target TM4C123G LaunchPad.

---

## TM4C123G LaunchPad

The development board targeted by this simulator.

It includes:

- TM4C123GH6PM microcontroller.
- Built-in RGB LED.
- SW1 and SW2.
- J1, J2, J3, and J4 headers.
- Debug and USB connections.

---

## Vector Table

A table located at the beginning of firmware memory.

It contains:

- Initial stack pointer.
- Reset handler address.
- Exception handler addresses.
- Interrupt handler addresses.

---

## Virtual Time

Time controlled by the simulation engine rather than the browser's real clock.

Virtual time is required for:

- SysTick.
- Timers.
- ADC timing.
- Logic-analyzer timestamps.
- Deterministic behavior.

---

## Wokwi-Style

A browser-based interactive workflow inspired by Wokwi.

This term describes the intended user experience only.

It does not imply compatibility, affiliation, or shared implementation with Wokwi.
