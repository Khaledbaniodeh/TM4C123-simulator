TM4C123 Educational Web Simulator

MVP Specification v0.1

Status: Approved baselineTarget board: EK-TM4C123GXL (TM4C123G LaunchPad)Project type: Wokwi-style educational web simulator

1. Project Scope

The project will provide a browser-based simulator where a student can:

Place a TM4C123 LaunchPad and supported parts on a workspace.

Connect parts using wires.

Write normal TM4C123 C code using register-level/CMSIS-style access.

Compile and execute the program.

Observe the result on the board and connected components.

Run, pause, stop, and reset the simulation.

The MVP is focused on the university laboratory examples listed in this document. It is not a complete Wokwi clone and does not simulate every TM4C123 peripheral.

A visually interactive board without real compiled-code execution is not considered a complete MVP.

2. Supported Components

Type

Description

board-tm4c123-launchpad

TM4C123G LaunchPad board

sim-led

External LED with A/C pins

sim-pushbutton

Interactive pushbutton

sim-resistor

Basic resistor/pull-up/pull-down behavior

sim-potentiometer

Analog input source

sim-lcd1602

HD44780-compatible 16x2 LCD

sim-logic-analyzer

Digital transition capture

Built-in board components

PF1: Red LED, active high

PF2: Blue LED, active high

PF3: Green LED, active high

PF4: SW1, active low

PF0: SW2, active low and locked at reset

Required LCD connection

PB0: RS

PB1: RW

PB2: E

PB4–PB7: D4–D7

Required ADC connection

PE3 / AIN0: Potentiometer analog signal

ADC result range: 0–4095

3. Supported Code Examples

The MVP must run real compiled C programs covering:

GPIOF LED output.

SW1/SW2 polling.

PF0 unlock using GPIO LOCK/CR.

GPIOF edge-triggered interrupts.

SysTick delays and interrupts.

TIMER0A, TIMER1A, and TIMER2A periodic interrupts.

LCD1602 in 4-bit mode on Port B.

ADC0 Sample Sequencer 3 polling on PE3/AIN0.

ADC0 SS3 interrupt-driven conversion.

Logic-analyzer capture of program-generated GPIO transitions.

The first end-to-end vertical slice is:

C source
→ Cortex-M4 compilation
→ ELF loading
→ ARM execution
→ TM4C MMIO write
→ GPIOF model
→ PF1 red LED state

4. Minimum Supported Registers

System Control

RCGCGPIO

PRGPIO

RCGCADC

RCGCTIMER

GPIO

DATA, including masked-address behavior

DIR

IS

IBE

IEV

IM

RIS

MIS

ICR

AFSEL

PUR

PDR

DEN

LOCK

CR

AMSEL

PCTL where required

Core peripherals

SysTick CTRL, LOAD, and VAL

Basic NVIC enable, pending, and interrupt dispatch

Vector table and user ISR execution

GPTM

CFG

TAMR

CTL

IMR

RIS

MIS

ICR

TAILR

TAPR where required

ADC0 SS3

ACTSS

EMUX

SSMUX3

SSCTL3

PSSI

RIS

IM

ISC

SSFIFO3

Important addresses

SYSCTL_RCGCGPIO : 0x400FE608
GPIOF base      : 0x40025000
GPIOF DATA full : 0x400253FC
GPIOF DIR       : 0x40025400
GPIOF DEN       : 0x4002551C
GPIOF LOCK      : 0x40025520
GPIOF CR        : 0x40025524
SysTick base    : 0xE000E010

5. Project File Format

Projects use a Wokwi-inspired diagram.json:

{
  "version": 1,
  "author": "",
  "editor": "tm4c-web-simulator",
  "parts": [
    {
      "id": "board1",
      "type": "board-tm4c123-launchpad",
      "left": 100,
      "top": 80,
      "rotate": 0,
      "attrs": {}
    }
  ],
  "connections": []
}

Part IDs must be unique.

A connection uses:

["led1:A", "board1:PF1", "red", []]

Supported orthogonal-routing commands:

v<number>

h<number>

*

6. Unsupported MVP Features

The first MVP does not include:

Complete Wokwi compatibility

Full analog/SPICE simulation

USB protocol emulation

CAN or Ethernet

DMA

EEPROM and hibernation

Complete PWM/motor-control simulation

All UART/I2C/SSI modules

JTAG/SWD or GDB debugging

Arbitrary boards and third-party MCU families

Every TM4C123 register and peripheral

Unsupported MMIO access must produce a clear warning and must not silently succeed.

7. Architecture Boundaries

UI Layer
├── Workspace
├── Board/part renderers
├── Wire renderer
└── Code editor

Project Layer
├── diagram.json parser
├── Schema validation
├── Part registry
└── Project state

Electrical Layer
├── Pins
├── Digital nets
└── Analog-input abstraction

Execution Layer
├── C compiler
├── ELF loader
├── Cortex-M4 execution engine
└── Interrupt dispatch

TM4C Layer
├── Memory/MMIO bus
├── SYSCTL
├── GPIO
├── SysTick/NVIC
├── GPTM
└── ADC

Instrumentation Layer
├── Logic analyzer
├── Simulation events
└── Error console

The UI must not directly fake MCU output. A visual state change must originate from executed program behavior or a valid physical input event.

8. Build Order

Phase 0 — Specification and risk reduction

PM-001: MVP Specification

PM-002: Code-example compatibility matrix

PM-003: Architecture design

RISK-001: C → ARM → MMIO → PF1 feasibility spike

Phase 1 — Project foundation

React + TypeScript setup

Tests, linting, and type checking

Core types

diagram.json schema/parser

Part registry

Phase 2 — Board and workspace

Board SVG

J1/J2/J3/J4 pins

Pin interaction

Pan/zoom

Part movement and rotation

Phase 3 — Parts and connections

LED

Pushbutton

Resistor

Potentiometer

LCD renderer

Logic-analyzer renderer

Wires and digital-net graph

Phase 4 — Memory and GPIO

MMIO bus

SYSCTL clock gating

GPIO A–F

RGB LED

SW1/SW2 and PF0 protection

Phase 5 — Interrupts and timing

NVIC

GPIO interrupts

SysTick

GPTM timers

Phase 6 — LCD1602

HD44780 state model

4-bit protocol

Commands and DDRAM

Text rendering

Phase 7 — ADC

ADC0 SS3

PE3/AIN0

Potentiometer

Polling and interrupt modes

Phase 8 — Logic analyzer

Signal subscriptions

Virtual timestamps

Digital waveforms

Phase 9 — Complete user workflow

C editor

Compilation

ELF loading/execution

Run/pause/reset

Project save/load

Compile/runtime errors

9. Mandatory Acceptance Tests

Duplicate part IDs are rejected.

The board and header pins render in their correct positions.

Valid compiled code can turn PF1 red LED on.

PF4 reads LOW while SW1 is pressed and HIGH when released.

PF0 configuration is blocked until correctly unlocked.

A falling edge on PF4 invokes GPIOF_Handler.

SysTick can periodically toggle PF3.

TIMER0A/1A/2A can produce independent periods.

The supplied LCD driver displays program-generated text.

ADC0 SS3 returns approximately 0, 2048, and 4095 for minimum, midpoint, and maximum potentiometer positions.

The logic analyzer displays program-generated pin transitions.

A user can compile, run, interact, pause, reset, and view errors.

10. Definition of Done

A task is complete only when:

The build succeeds.

Type checking succeeds.

Automated tests succeed.

No unhandled browser-console errors exist.

No unsupported operation silently succeeds.

Changes remain inside the task scope.

Relevant interfaces are documented.

The task includes an acceptance test.

The MVP is complete only when real compiled user C code drives simulated TM4C registers and visible connected components.
