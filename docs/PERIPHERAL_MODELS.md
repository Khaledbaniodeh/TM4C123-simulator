# Peripheral Models

Register-level models of TM4C123GH6PM peripherals, implemented as Renode C#
peripherals in [`simulator/renode/peripherals/`](../simulator/renode/peripherals/)
and wired in [`tm4c123gh6pm.repl`](../simulator/renode/platforms/tm4c123gh6pm.repl).

Reference: *Tiva™ TM4C123GH6PM Microcontroller Data Sheet* (TI literature
number SPMS376E). Behavior is checked against the datasheet text; **no model
has been compared against a physical LaunchPad yet**.

## Platform

| Item | Value | Source |
|---|---|---|
| CPU | Renode `CortexM`, `cortex-m4f` | Renode built-in |
| Flash | 256 KB at `0x00000000` | Table 2-4 |
| SRAM | 32 KB at `0x20000000` | Table 2-4 |
| NVIC | Renode built-in at `0xE000E000`, 3 priority bits (`priorityMask 0xE0`) | §3.1.2 |
| SysTick | Renode NVIC, clocked at the live system clock (16 MHz at reset) | Periods verified at 16/50/80 MHz (`tests/timers.test.js`) |
| Instruction rate | System clock in MHz as MIPS (16 at reset, 50 with the lab PLL setup) — 1 instruction/clock | Approximation — not cycle-accurate (D-030) |
| Bit-banding | Not modeled | — |

## System Control (`TM4C123SystemControl.cs`, `0x400FE000`)

| Register | Offset | Behavior |
|---|---|---|
| `RIS` | `0x050` | `PLLLRIS` (bit 6) set when the PLL is powered / reconfigured; read-only |
| `IMC` | `0x054` | Stored; the system-control interrupt is not modeled (`unsupported-register-access` if non-zero) |
| `MISC` | `0x058` | Reads `RIS & IMC`; write 1 to clear `RIS` bits |
| `RCC` | `0x060` | Reset `0x078E3AD1`; `MOSCDIS`, `OSCSRC`, `XTAL`, `BYPASS`, `PWRDN`, `USESYSDIV`, `SYSDIV` |
| `RCC2` | `0x070` | Reset `0x07C06810`; `USERCC2` overrides `RCC`; `OSCSRC2`, `BYPASS2`, `PWRDN2`, `SYSDIV2LSB`, `SYSDIV2`, `DIV400` |
| `RCGC1` (legacy) | `0x104` | Bits 19:16 gate TIMER0–3; other bits stored only |
| `RCGC2` (legacy) | `0x108` | Bits 5:0 gate GPIO A–F; UDMA/USB0 bits stored only |
| `PLLSTAT` | `0x168` | `LOCK` = PLL powered |
| `RCGCTIMER` | `0x604` | Bits 5:0 gate TIMER0–5 |
| `RCGCGPIO` | `0x608` | Bits 5:0 gate GPIO A–F |
| `PRTIMER` | `0xA04` | Read-only; mirrors the effective timer clock gates |
| `PRGPIO` | `0xA08` | Read-only; mirrors the effective GPIO clock gates |
| everything else | — | `unsupported-register-access`, read 0, write ignored |

### Clock tree (decision D-030)

System clock, per the datasheet's `RCC`/`RCC2` rules:

| Configuration | System clock |
|---|---|
| `BYPASS(2)=1`, `USESYSDIV=0` | Oscillator: MOSC (from `XTAL`), PIOSC 16 MHz, PIOSC/4, LFIOSC (30 kHz nominal), 32.768 kHz |
| `BYPASS(2)=1`, `USESYSDIV=1` | Oscillator ÷ (`SYSDIV(2)` + 1) |
| PLL, `RCC2.DIV400=1` | 400 MHz ÷ ((`SYSDIV2`:`SYSDIV2LSB`) + 1) |
| PLL, otherwise | 200 MHz ÷ (`SYSDIV(2)` + 1) |

The derived clock is emitted as `system-clock-changed` (`hz`, `source`,
`pll`, `divisor`, `cause`) and applied to the CPU instruction rate, SysTick,
and the GPTM timers. `clock-configuration-warning` is emitted for clocks
above 80 MHz, a PLL selected while powered down, a PLL reference other than
MOSC/PIOSC, and MOSC selected while `MOSCDIS=1`.

Assumptions:

- The PLL locks immediately (no lock delay), so `while (!(RIS & PLLLRIS))`
  loops exit after one iteration.
- Effective GPIO clock = `RCGCGPIO` OR legacy `RCGC2`; effective timer clock
  = `RCGCTIMER` OR legacy `RCGC1[19:16]`. Mixing both register sets is not
  verified.
- `PRGPIO`/`PRTIMER` are ready immediately after a clock enable.
- **Not modeled yet:** sleep/deep-sleep clock configuration, `MOSCCTL`,
  `PIOSCCAL`, other run-mode clock gates (UART, ADC, …), `DID0/DID1`.

## GPTM timers (`TM4C123GeneralPurposeTimer.cs`, TIMER0–5)

Base `0x40030000 + n·0x1000`. NVIC lines: TIMER0A/B 19/20, 1A/B 21/22,
2A/B 23/24, 3A/B 35/36, 4A/B 70/71, 5A/B 92/93. Built on Renode
`LimitTimer`, so counting happens in emulation virtual time at the live
system clock.

| Feature | Status |
|---|---|
| `GPTMCFG` 0 (32-bit, timer A) and 4 (16-bit A and B) | ✅ Verified (H, I) |
| `TnMR` one-shot (1) and periodic (2), count down / up (`TnCDIR`) | ✅ Periodic down verified; one-shot / up implemented, not yet tested |
| `TnILR`, period = (`TnILR`+1)·(`TnPR`+1) clocks in 16-bit mode, (`TnILR`+1) in 32-bit mode | ✅ Verified |
| `GPTMIMR` / `RIS` / `MIS` / `ICR` timeout interrupts → NVIC | ✅ Verified |
| `TnR` / `TnV` read-back, `TnV` write | Implemented, not yet tested |
| Clock gating: access while unclocked → precise bus fault | ✅ Verified |
| Capture, PWM, RTC, match interrupts, wait-on-trigger, ADC trigger, `GPTMSYNC` | ⛔ `unsupported-feature` event |

Simplifications: a `TnILR` write while running reloads the counter at once;
`TnPV` reads 0 in prescaled mode; in 32-bit mode timer B is unused.

## GPIO (`TM4C123GPIO.cs`, APB apertures)

Ports A–D at `0x40004000 + n·0x1000`, E–F at `0x40024000 + (n−4)·0x1000`.
IRQ lines: A–E → 0–4, F → 30.

| Register | Offset | Behavior |
|---|---|---|
| `GPIODATA` | `0x000–0x3FC` | Address bits [9:2] mask reads and writes. Reads: outputs return the DATA latch, inputs the input buffer, DEN=0 pins read 0 |
| `GPIODIR` | `0x400` | 1 = output |
| `GPIOIS/IBE/IEV/IM` | `0x404–0x410` | Edge/level, both-edge, polarity, mask |
| `GPIORIS` / `GPIOMIS` | `0x414` / `0x418` | Read-only status; MIS = RIS & IM drives the NVIC line |
| `GPIOICR` | `0x41C` | Write-1-to-clear edge status; level sources re-assert |
| `GPIOAFSEL` | `0x420` | Stored; any set bit → `unsupported-feature` (alternate functions not modeled) |
| `GPIODR2R/4R/8R` | `0x500–0x508` | Stored, mutually exclusive; no electrical effect |
| `GPIOODR` | `0x50C` | Open drain: output HIGH becomes high-impedance |
| `GPIOPUR` / `GPIOPDR` | `0x510` / `0x514` | Mutually exclusive weak pulls |
| `GPIOSLR` | `0x518` | Stored only |
| `GPIODEN` | `0x51C` | Digital enable (output driver and input buffer) |
| `GPIOLOCK` | `0x520` | Write `0x4C4F434B` to unlock; any other value locks. Reads 1 locked / 0 unlocked |
| `GPIOCR` | `0x524` | Writable only while unlocked; only commit-protected pins (PC[3:0], PD7, PF0) have writable bits |
| `GPIOAMSEL` | `0x528` | Stored; set bits → `unsupported-feature` |
| `GPIOPCTL` | `0x52C` | Stored (32-bit) |
| `GPIOADCCTL` / `GPIODMACTL` | `0x530` / `0x534` | Stored; set bits → `unsupported-feature` |
| other offsets | — | `unsupported-register-access` |

Reset values: all zero except `DR2R = 0xFF`, `GPIOLOCK` locked,
`GPIOCR = 0xFF` minus protected pins, and the JTAG pins PC[3:0]
(`AFSEL = DEN = PUR = 0x0F`, `PCTL = 0x1111`), per Table 10-1.

Commit protection (`GPIOCR`) gates writes to `AFSEL`, `PUR`, `PDR`, and
`DEN`. Blocked bits keep their old value and emit
`commit-protected-write-ignored`.

### Clock gating

Any access to a port whose clock is disabled emits `bus-fault` and throws a
Renode `BusAccessException`, so the CPU takes a precise bus fault (escalated
to HardFault unless the firmware enables BusFault). Verified by the
`missing-clock` test: HFSR.FORCED, CFSR.PRECISERR|BFARVALID, BFAR =
`0x40025400`.

### Pin resolution

For each pin, in priority order:

1. GPIO output driving (clock on, DEN, DIR, not AFSEL; ODR + HIGH does not drive) **and** an external driver at the opposite level → `conflict`
2. GPIO output → `high`/`low`, drive `output`
3. External driver (board switch, test harness) → its level, drive `external`
4. Pull-up / pull-down (clock on) → `high`/`low`
5. Otherwise → `floating`

The input buffer (DEN = 1) reads `high` as 1; `low`, `floating`, and
`conflict` read as 0. Reading a floating input emits `floating-input-read`
once per pin until its state changes. When a port's clock is removed after
configuration, its outputs are treated as not driven (RISK-001 rule); the
real silicon behavior in that case is unverified.

### Board wiring (LaunchPad)

| Board part | Pin | Model |
|---|---|---|
| Red / blue / green LED | PF1 / PF2 / PF3 | Lit only when driven HIGH by a GPIO output |
| SW1 / SW2 | PF4 / PF0 | Pressed = external driver LOW; released = no driver (needs the internal pull-up) |

## Unimplemented peripherals (`TM4C123UnimplementedPeripheral.cs`)

UART0–7, WTIMER0–5, ADC0–1, SSI0–3, I2C0–3, PWM0–1, QEI0–1, WDT0–1,
CAN0–1, COMP, USB0, GPIO AHB apertures, EEPROM, HIB, flash controller,
system exception module, and uDMA are mapped as named placeholder regions.
The first read and first write to each register emit
`unimplemented-peripheral-access`. Reads return 0 and writes are ignored.
Remove a placeholder from the platform when a real model replaces it.

## Reserved address space

Accesses to unmapped addresses raise a precise bus fault through Renode's
`UnhandledAccessBehaviour ThrowException`. The orchestrator reports the
fault as a `cpu-fault` event with BFAR.
