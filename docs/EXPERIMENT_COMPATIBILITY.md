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
| 6 | GPIO inputs and interrupts | ✅ for the hardware behavior (C firmware) · ⛔ for unmodified lab code | Lab code uses `TM4C123.h` (`GPIOF->DIR`, `NVIC->ISER[0]`) — needs a compatible device header (D-023) |
| 7 | SysTick and GPTM timers | 🟡 Core verified | PLL to 50 MHz, SysTick, and TIMER0A–2A periodic verified with examples G–I. Lab code still needs the `TM4C123.h` device header (D-023) |
| 8 | LCD1602 (HD44780, 4-bit, Port B) | 📋 Planned | GPIO Port B works; LCD model not implemented. Depends on SysTick and the 50 MHz clock |
| 9 | ADC0 SS3, PE3/AIN0 | 📋 Planned | ADC0 is a placeholder region (accesses are reported) |
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
| CMSIS `TM4C123.h` (`GPIOF->…`, `NVIC_EnableIRQ`) | ⛔ | Needs a license-compatible device header (D-023) |
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
| CMSIS `TM4C123.h` (`TIMER1->CTL`, `SystemCoreClock`) | ⛔ Needs a license-compatible device header (D-023) |
| Deterministic virtual timing | ✅ Determinism test on the three-timer trace |

## Experiment 8 — LCD1602

| Requirement | Status |
|---|---|
| Port B GPIO outputs PB0–PB2, PB4–PB7 | ✅ (generic GPIO model; no LCD-specific test) |
| Wiring: RS=PB0, RW=PB1 (also tied to GND), E=PB2, D4–D7=PB4–PB7 | 📋 Connection profile defined (D-024) |
| HD44780 4-bit init (0x3 ×3, 0x2), function set 0x28, 0x0C, 0x06, clear 0x01 | 📋 Planned |
| DDRAM addressing 0x80 / 0xC0, cursor, shift 0x18/0x1C | 📋 Planned |
| Delays via SysTick COUNTFLAG at 50 MHz | 🟡 Clock model verified; COUNTFLAG polling not yet tested |
| Text rendered only from firmware-driven LCD transactions | 📋 Design requirement |

## Experiment 9 — ADC

| Requirement | Status |
|---|---|
| `RCGCADC`, PE3 analog setup (`AFSEL/DEN/AMSEL`) | 🟡 GPIO side stored + reported; analog not modeled |
| ADC0 `ACTSS/EMUX/SSMUX3/SSCTL3/PSSI/RIS/SSFIFO3/ISC/IM` | 📋 Planned (ADC0 is a placeholder region) |
| `ADC0SS3_Handler` at IRQ 17 | 📋 Planned (vector exists in `startup.s`) |
| 12-bit result, 0–3.3 V input from a virtual potentiometer | 📋 Planned |
| Internal temperature sensor (`SSCTL3.TS0`) | 📋 Planned |
| ADC1 / AIN1 (PE2) for Task 2 | 📋 Planned |

## Experiment 10 — UART

| Requirement | Status |
|---|---|
| `RCGCUART`, PA0/PA1 `AFSEL` + `PCTL` = 1 | ⛔ Alternate-function routing not modeled |
| `UARTCTL/IBRD/FBRD/LCRH/CC/FR/DR` | 📋 Planned (UART0 placeholder region) |
| 115200 baud with IBRD=27, FBRD=8 (implies 50 MHz) | 📋 Clock model available (D-030); UART not modeled |
| Polling TX/RX on `TXFF` / `RXFE` | 📋 Planned |
| Virtual serial terminal with input injection | 📋 Planned (Renode UART analyzers/socket terminals are candidates) |

## Next engineering task

1. Provide an original, license-compatible `TM4C123.h`-compatible device
   header + `SystemInit`/`SystemCoreClock` so Experiment 6–7 style code
   compiles unchanged (D-023).
2. Verify SysTick `COUNTFLAG` polling and `CLKSOURCE`=0, and GPTM one-shot
   mode, with dedicated tests.
3. LCD1602 (HD44780) model on Port B for Experiment 8.
