# Experiment Compatibility — Experiments 5–10

Status of TM4C123 LaunchPad laboratory Experiments 5–10
([encs4110.me/experiments](https://encs4110.me/experiments/5)) against this
simulator. The requirements below come from reading those pages
(2026-10-19). The project contains **original** firmware that exercises the
same hardware behavior. No laboratory code or manuals are copied here.

**Status vocabulary**

| Status | Meaning |
|---|---|
| ✅ Implemented and verified | Implemented and covered by passing automated tests |
| 🟡 Implemented, not fully validated | Code exists; tests partial or engine-provided |
| 🧪 Visual prototype only | UI exists without real behavior |
| 🔧 In progress | Being implemented |
| 📋 Planned | Designed, not implemented |
| ⛔ Blocked | Needs a prerequisite listed in the row |

Hardware equivalence (comparison with a physical LaunchPad) is **unverified
for every row**.

## Summary

| Exp. | Topic | Overall | Notes |
|---|---|---|---|
| 5 | GPIO output | ✅ for the hardware behavior (C firmware) · ⛔ for the original ARMASM source | Keil ARMASM is not accepted by GNU `as`; see the conversion path below |
| 6 | GPIO inputs and interrupts | ✅ Hardware behavior and `TM4C123.h`-style code verified | Example J uses `GPIOF->…`, `NVIC->IP`, `NVIC_EnableIRQ` with the project's original device header (D-031). Unmodified lab sources not tested here |
| 7 | SysTick and GPTM timers | ✅ Core verified, incl. `TM4C123.h`-style code | PLL 50 MHz, SysTick, TIMER0A–2A verified (G–I); example K uses `SystemCoreClock`, `SysTick_Config`, `TIMER1->…` (D-031). Unmodified lab sources not tested here |
| 8 | LCD1602 (HD44780, 4-bit, Port B) | ✅ Verified | Example L with the Experiment 8 wiring; text comes only from firmware GPIO writes (D-032). Unmodified lab sources not tested here |
| 9 | ADC0 SS3, PE3/AIN0, temperature sensor | ✅ Verified | Examples M (potentiometer on AIN0) and N (temperature sensor, ADC1, interrupt) (D-033). Unmodified lab sources not tested here |
| 10 | UART0 echo, PA0/PA1 | 📋 Planned (scope added by D-022) | UART0 is a placeholder region; needs alternate functions + 50 MHz clock |

## Experiment 5 — GPIO output

| Requirement | Status | Evidence |
|---|---|---|
| `RCGCGPIO` Port F clock enable | ✅ | `integration.test.js` A, missing-clock |
| `GPIODIR`, `GPIODEN` | ✅ | A, missing-direction, missing-digital-enable |
| Masked `GPIODATA` addressing (e.g. `0x40025008` for PF1, `0x40025038` for PF1–PF3) | ✅ | `gpiof-blink` uses the `0x40025008` alias; blink + determinism tests |
| RGB LED PF1/PF2/PF3 | ✅ PF1 · 🟡 PF2/PF3 | PF3 toggled in the interrupt test; PF2 shares the same code path, but no test drives it |
| Color combinations | 🟡 | Same GPIO path; no dedicated combination test yet |
| Software delay blink | ✅ | Blink test; the period follows the instruction count at 16 MIPS (approximate) |
| Keil ARMASM source (`AREA`, `EXPORT __main`, `PROC/ENDP`) | ⛔ Not supported | See below |

**ARMASM → GNU assembler conversion path** (manual today; an automated
translator for this subset is a candidate task):

| Keil ARMASM | GNU `as` (`.syntax unified`) |
|---|---|
| `AREA \|.text\|, CODE, READONLY` | `.section .text` |
| `THUMB` | `.thumb` |
| `EXPORT __main` | `.global main` (this project's startup calls `main`) |
| `__main PROC` … `ENDP` | `.thumb_func` + `main:` … (no `ENDP`) |
| `label EQU 0x40025000` | `.equ label, 0x40025000` |
| `; comment` | `@ comment` or `/* */` |
| `ALIGN` | `.align 2` |
| `END` | (remove) |

Native ARMASM input is **not implemented and not claimed**.

## Experiment 6 — GPIO inputs and interrupts

| Requirement | Status | Evidence |
|---|---|---|
| SW1 PF4 / SW2 PF0 active-low with `GPIOPUR` | ✅ | D (SW1 polling), E (both switches) |
| PF0 `GPIOLOCK` / `GPIOCR` unlock | ✅ | E (unlocked), locked-commit negative test |
| Edge detection `GPIOIS/IBE/IEV` | 🟡 | Falling edge verified; both-edges and level paths implemented without dedicated tests |
| `GPIOIM`, `GPIOMIS`, `GPIOICR` | ✅ | E: ISR reads MIS and clears via ICR; IRQ line de-asserts |
| NVIC enable (`ISER0` bit 30) and real ISR execution | ✅ | E: `GPIOF_Handler` toggles LEDs |
| Software debounce with a 20 ms delay | 🟡 | Depends on delay-loop timing (approximate) |
| CMSIS-style `TM4C123.h` (`GPIOF->…`, `NVIC->IP`, `NVIC_EnableIRQ`) | ✅ | J: original device header (D-031) |
| Switch bounce on real hardware | ⛔ Not modeled | Simulated switches are ideal |

## Experiment 7 — SysTick and GPTM timers

| Requirement | Status |
|---|---|
| 50 MHz system clock via RCC2/PLL (MOSC 16 MHz, `DIV400`, `SYSDIV2`=7, wait for `PLLLRIS`) | ✅ G, H, I (`system-clock-changed` = 50 MHz, `PLLSTAT.LOCK`) |
| SysTick `LOAD/VAL/CTRL` = 7, `SysTick_Handler` | ✅ G: 5,000,000 clocks = 100 ms; follows the clock (312.5 ms at 16 MHz, 62.5 ms at 80 MHz) |
| SysTick `COUNTFLAG` polling delay, `CLKSOURCE`=0 (PIOSC/4) | 🟡 Engine-provided (Renode NVIC); not yet tested |
| `RCGCTIMER` / `PRTIMER`, unclocked timer access | ✅ Bus fault at the first GPTM access when the clock is off |
| GPTM `CTL/CFG/TAMR/TAPR/TAILR/IMR/MIS/ICR` | ✅ Modeled (`docs/PERIPHERAL_MODELS.md`) |
| 16-bit periodic mode with prescaler (TAPR = 255, TAILR = 0xFFFF) | ✅ H: TIMER1A every 0.33554432 s at 50 MHz |
| 32-bit periodic mode, TIMER0A/1A/2A at IRQ 19/21/23 | ✅ I: 250 / 500 / 1000 ms concurrently |
| One-shot mode, up-count, capture/PWM modes | 🟡 One-shot/up implemented, untested; capture/PWM reported as `unsupported-feature` |
| CMSIS-style `TM4C123.h` (`TIMER1->CTL`, `SystemCoreClock`, `SysTick_Config`) | ✅ K: `SystemInit` sets 50 MHz before `main` (D-031) |
| Deterministic virtual timing | ✅ Determinism test on the three-timer trace |

## Experiment 8 — LCD1602

| Requirement | Status |
|---|---|
| Port B GPIO outputs PB0–PB2, PB4–PB7 | ✅ L |
| Wiring: RS=PB0, RW=PB1 (also tied to GND), E=PB2, D4–D7=PB4–PB7 | ✅ `examples/lcd1602-hello/diagram.json`; PB1 HIGH against the GND tie is a pin conflict (D-024, tested) |
| HD44780 4-bit init (0x3 ×3, 0x2), function set 0x28, 0x0C, 0x06, clear 0x01 | ✅ L + controller unit tests |
| DDRAM addressing 0x80 / 0xC0, cursor, shift 0x18/0x1C | ✅ Unit tests (incl. 0x27→0x40 wrap, entry-mode decrement, shift on write) |
| CGRAM custom characters (0x40) | ✅ L: heart glyph drawn from the firmware's bitmap |
| Delays via SysTick COUNTFLAG at 50 MHz | ✅ L polls `COUNTFLAG`; LCD execution-time checks pass |
| Execution-time violations (37 µs / 1.52 ms, 15 ms power-on) | ✅ Reported as LCD timing warnings (tested) |
| Busy-flag / RAM reads (RW = 1) | ⛔ Not modeled — RW is tied to GND in the supported wiring; an RW = 1 strobe is reported |
| Text rendered only from firmware-driven LCD transactions | ✅ Every character comes from E falling edges in the GPIO event stream |
| Speed of `COUNTFLAG`-polling delays | 🟡 Correct in virtual time; ~0.13× real time steady (first 200 ms ~0.06×) because every poll is an emulated register read ([PERFORMANCE.md](PERFORMANCE.md), D-034) |

## Experiment 9 — ADC

| Requirement | Status |
|---|---|
| `RCGCADC`, PE3 analog setup (`AFSEL/DEN/AMSEL`) | ✅ M; a missing `AMSEL` reads 0 and is reported (tested) |
| ADC0 `ACTSS/EMUX/SSMUX3/SSCTL3/PSSI/RIS/SSFIFO3/ISC/IM` | ✅ M (PSSI + RIS polling) |
| SS3 interrupt handler (`ADC0SS3_Handler` IRQ 17, `ADC1SS3_Handler` IRQ 51) | ✅ N on ADC1; the ADC0 line uses the same code path |
| 12-bit result, 0–3.3 V input from a virtual potentiometer | ✅ M + Playwright: the workspace knob drives PE3 |
| Internal temperature sensor (`SSCTL3.TS0`) | ✅ N: die temperature set in the workspace (select U1) |
| ADC1 / AIN1 (PE2) for Task 2 | ✅ ADC1 and every AIN pin are modeled; N exercises ADC1, PE2 has no dedicated test |
| Hardware averaging, sample rate | 🟡 Affect conversion time; implemented, not yet tested |

## Experiment 10 — UART

| Requirement | Status |
|---|---|
| `RCGCUART`, PA0/PA1 `AFSEL` + `PCTL` = 1 | ⛔ Alternate-function routing not modeled |
| `UARTCTL/IBRD/FBRD/LCRH/CC/FR/DR` | 📋 Planned (UART0 placeholder region) |
| 115200 baud with IBRD=27, FBRD=8 (implies 50 MHz) | 📋 Clock model available (D-030); UART not modeled |
| Polling TX/RX on `TXFF` / `RXFE` | 📋 Planned |
| Virtual serial terminal with input injection | 📋 Planned (Renode UART analyzers/socket terminals are candidates) |

## Device header (D-031)

`#include "TM4C123.h"` provides, as original code:

| Area | Provided |
|---|---|
| Peripheral structs + instances | `SYSCTL`, `GPIOA`–`GPIOF` (+ `_AHB`), `TIMER0`–`5`, `WTIMER0`–`5`, `UART0`–`7`, `ADC0`–`1` |
| Interrupt numbers | `IRQn_Type` for every implemented IRQ (0–138) and the system exceptions |
| Core | `NVIC`, `SCB`, `SysTick` structs; `NVIC_Enable/DisableIRQ`, `Set/Get/ClearPendingIRQ`, `Set/GetPriority`, `SetPriorityGrouping`, `NVIC_SystemReset`, `SysTick_Config`; `__enable_irq`, `__disable_irq`, `__WFI`, `__WFE`, `__NOP`, `__DSB`, `__ISB`, `__DMB`, PRIMASK/BASEPRI access |
| System | `SystemInit()` (50 MHz PLL, called before `main`), `SystemCoreClock`, `SystemCoreClockUpdate()` |
| Not provided | SSI, I2C, PWM, QEI, CAN, USB, uDMA, HIB, EEPROM, watchdog structs; ITM, MPU, FPU, and other CMSIS-Core extras — using them is a compile error |

Compiling is not simulating: registers of unmodeled peripherals (UART
today) compile but are reported at run time as unimplemented.

## Next engineering task

1. UART0 with a virtual serial terminal for Experiment 10.
2. Dedicated tests for SysTick `CLKSOURCE`=0, GPTM one-shot/up-count, ADC
   SS0–SS2, continuous trigger, and hardware averaging.
3. Wall-clock speed of `COUNTFLAG`-polling firmware: measured, root cause in
   Renode MMIO cost, no safe fix available ([PERFORMANCE.md](PERFORMANCE.md)).
