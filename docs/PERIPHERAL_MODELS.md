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
| SysTick | Renode NVIC, clocked at 16 MHz | Not yet verified against TM4C clock options |
| Instruction rate | 16 MIPS (≈ 16 MHz PIOSC, 1 instruction/cycle) | Approximation — not cycle-accurate |
| Bit-banding | Not modeled | — |

## System Control (`TM4C123SystemControl.cs`, `0x400FE000`)

| Register | Offset | Behavior |
|---|---|---|
| `RCGC2` (legacy) | `0x108` | Bits 5:0 gate GPIO A–F; UDMA/USB0 bits stored only |
| `RCGCGPIO` | `0x608` | Bits 5:0 gate GPIO A–F |
| `PRGPIO` | `0xA08` | Read-only; mirrors the effective GPIO clock gates |
| everything else | — | `unsupported-register-access`, read 0, write ignored |

Assumptions:

- Effective GPIO clock = `RCGCGPIO` OR legacy `RCGC2`. The datasheet
  discourages mixing both register sets; mixed use is not verified.
- `PRGPIO` is ready immediately after a clock enable. Silicon takes a few
  clocks; firmware that polls `PRGPIO` behaves the same.
- **Not modeled yet:** `RCC`/`RCC2`/`RIS` (PLL), other run/sleep/deep-sleep
  clock gates, `DID0/DID1`. Lab code from Experiments 7–10 needs these
  (decision D-023).

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

UART0–7, TIMER0–5, WTIMER0–5, ADC0–1, SSI0–3, I2C0–3, PWM0–1, QEI0–1, WDT0–1,
CAN0–1, COMP, USB0, GPIO AHB apertures, EEPROM, HIB, flash controller,
system exception module, and uDMA are mapped as named placeholder regions.
The first read and first write to each register emit
`unimplemented-peripheral-access`. Reads return 0 and writes are ignored.
Remove a placeholder from the platform when a real model replaces it.

## Reserved address space

Accesses to unmapped addresses raise a precise bus fault through Renode's
`UnhandledAccessBehaviour ThrowException`. The orchestrator reports the
fault as a `cpu-fault` event with BFAR.
