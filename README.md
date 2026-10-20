<div align="center">

# TM4C123 Simulator

### Cortex-M4 Firmware & Peripheral Simulation

Real C firmware → `arm-none-eabi-gcc` → Cortex-M4 ELF → Renode → TM4C123
register-level models → browser.

[![CI](https://github.com/Khaledbaniodeh/TM4C123-simulator/actions/workflows/ci.yml/badge.svg)](https://github.com/Khaledbaniodeh/TM4C123-simulator/actions/workflows/ci.yml)
![Stage](https://img.shields.io/badge/stage-early%20technical%20prototype-1f6feb)
![Hardware equivalence](https://img.shields.io/badge/hardware%20equivalence-not%20verified-d29922)

<img src="./docs/images/workspace-sw1-pressed.png" alt="TM4C123 Simulator workspace: SW1 held, PF4 LOW, PF1 HIGH driven by firmware, red LED on" width="100%">

<sub>Screenshot captured by the automated Playwright test while SW1 is held:
PF4 reads LOW from the switch, the polling firmware drives PF1 HIGH, and the
red LED reflects the GPIO model's event.</sub>

</div>

---

## What this is

A simulator for the TM4C123G LaunchPad that **executes real compiled
firmware** and models TM4C123GH6PM peripherals **at the register level**.
Everything the board view shows is derived from events emitted by those
models while the Cortex-M4 executes your code. No frontend animation,
source-text matching, or wall-clock timer decides hardware state.

Use cases: learning register-level programming (GPIO, interrupts, clock
gating), testing small bare-metal programs without hardware, and
reproducible, scriptable firmware experiments.

> [!IMPORTANT]
> **Status: early technical prototype.** The first end-to-end path
> (RISK-001) is implemented and verified by automated tests. GPIO, GPIO
> interrupts, faults, the clock tree, SysTick, GPTM timers, and an LCD1602
> work, and so do ADC0/ADC1. UART is **not modeled yet**. Simulated behavior has **not**
> been compared against a physical LaunchPad.

## What works today

| Capability | Status |
|---|---|
| C → Cortex-M4 ELF with original bare-metal startup + linker script | ✅ Implemented & tested |
| Execution on Renode 1.17.0 (Cortex-M4F + NVIC) | ✅ Implemented & tested |
| SYSCTL GPIO clock gating (`RCGCGPIO`, legacy `RCGC2`, `PRGPIO`) | ✅ Implemented & tested |
| GPIO A–F: masked DATA, DIR, DEN, pull-up/down, open drain | ✅ Implemented & tested |
| PF0 `GPIOLOCK`/`GPIOCR` commit protection | ✅ Implemented & tested |
| GPIO edge interrupts → NVIC → firmware ISR → ICR | ✅ Implemented & tested (falling edge) |
| Precise bus faults: unclocked GPIO, reserved addresses | ✅ Implemented & tested |
| On-board RGB LED (PF1–PF3) and SW1/SW2 (PF4/PF0) | ✅ Implemented & tested |
| Reset, deterministic virtual time, structured runtime events | ✅ Implemented & tested |
| Browser workspace: editor, compile/run/pause/reset/stop, diagnostics, pin inspector | ✅ Implemented & tested (Playwright) |
| EK-TM4C123GXL board placed from TI CAD data (SPMR240); J1–J4 pinout verified against SPMU296 in CI | ✅ Implemented & tested |
| Interactive board: 40 wireable header pins with live tooltips, SW1/SW2, firmware-driven RGB LED, selectable components | ✅ Implemented & tested (Playwright) |
| Circuit workspace: pan/zoom/fit, grid/snap, drag/rotate/duplicate/delete, undo/redo, orthogonal wiring with validation | ✅ Implemented & tested (Playwright) |
| `diagram.json` save/load (Wokwi-inspired format; full Wokwi compatibility not claimed) | ✅ Implemented & tested |
| External LED / resistor / pushbutton wired to header GPIOs (logic-level netlist → real GPIO model) | ✅ Implemented & tested (example F) |
| SYSCTL clock tree: RCC/RCC2/PLL, 16–80 MHz, PLL lock | ✅ Implemented & tested (examples G–I) |
| SysTick interrupt and `COUNTFLAG` polling at the core clock | ✅ Implemented & tested (G, K, L) |
| GPTM TIMER0–5: 16/32-bit periodic with prescaler, timeout IRQs | ✅ Implemented & tested (H, I, K) |
| LCD1602 (HD44780) wired in the workspace, 4/8-bit, CGRAM | ✅ Implemented & tested (example L; driven only by firmware GPIO writes) |
| ADC0/ADC1 sample sequencers, internal temperature sensor | ✅ Implemented & tested (examples M, N; SS3) |
| Potentiometer wired to an AIN pin (ideal divider → real ADC model) | ✅ Implemented & tested (example M, Playwright) |
| Logic analyzer part | 🟡 Editor only — placeable and wireable, **no electrical behavior yet** |
| UART0 | 📋 Planned — accesses are **reported**, never silently accepted |
| CMSIS-style `TM4C123.h` code (`GPIOF->DATA`, `NVIC_EnableIRQ`, `SystemCoreClock`) | ✅ Original device header + `SystemInit` (50 MHz) ([details](docs/EXPERIMENT_COMPATIBILITY.md#device-header-d-031)) |
| Keil ARMASM sources | ⛔ Not supported ([details](docs/EXPERIMENT_COMPATIBILITY.md)) |

Lab coverage for Experiments 5–10 is tracked in
[`docs/EXPERIMENT_COMPATIBILITY.md`](docs/EXPERIMENT_COMPATIBILITY.md).

## Circuit workspace

The board is an interactive component:
- **Header pins.** Each of the 40 pins has a hover tooltip showing the header pin, GPIO, analog and alternate functions, on-board role, and the live simulated level. You can start or end a wire on any pin.
- **On-board controls.** SW1/SW2 drive the real GPIO model while held. The RGB LED lights only from firmware-driven pin events.
- **Components.** Clicking a component (MCU, ICDI, USB connectors, crystals, R9/R10, headers…) shows its technical details and whether it is *simulated* or *visual only*.

Wires are orthogonal and snap to the 0.1 in grid. They stay attached when parts move, and you can recolor or reroute them. Wires between supply and ground, and duplicate wires, are rejected. Circuits save and load as `diagram.json`.

Board provenance and the status of every element:
[`docs/BOARD_MODEL.md`](docs/BOARD_MODEL.md).

## Architecture

```mermaid
flowchart LR
  UI[Browser workspace] -- build / run / input --> ORCH[Node.js orchestrator<br/>loopback only]
  ORCH -- fixed argv --> GCC[arm-none-eabi-gcc 15.2.1] --> ELF[(ELF)]
  ORCH -- Monitor: LoadELF · RunFor · Reset --> R[Renode 1.17.0<br/>Cortex-M4F + NVIC]
  R -- MMIO --> M[C# TM4C123 models<br/>SYSCTL · GPIO A–F · placeholders]
  M -- JSON-lines events<br/>virtual time + sequence --> ORCH
  ORCH -- Server-Sent Events --> UI
```

- **Virtual time is authoritative.** The orchestrator advances emulation
  time with `RunFor`, so runs are deterministic. Wall-clock pacing is only
  for display, and the UI shows the measured real-time factor.
- **No log scraping.** Pin state comes from model events. CPU faults come
  from the ARMv7-M SCB registers (CFSR/HFSR/BFAR).
- **Unsupported is visible.** Unmodeled registers and peripherals emit
  events, and reserved addresses bus-fault.

More detail: [`docs/TECHNICAL_OVERVIEW.md`](docs/TECHNICAL_OVERVIEW.md) ·
[`docs/PERIPHERAL_MODELS.md`](docs/PERIPHERAL_MODELS.md) ·
[`docs/RUNTIME_EVENTS.md`](docs/RUNTIME_EVENTS.md) ·
[`docs/DECISION_LOG.md`](docs/DECISION_LOG.md)

## Quick start

Requirements: **Node.js ≥ 20.11**, Windows x64 or Linux x64, ~2 GB disk
for the toolchains. No administrator rights are needed.

```bash
git clone https://github.com/Khaledbaniodeh/TM4C123-simulator.git
cd TM4C123-simulator
npm run setup:tools    # downloads pinned GCC + Renode into .tools/ and verifies SHA-256
npm ci
npm start              # http://127.0.0.1:5123/
```

`setup:tools` installs exactly the versions in
[`tools.lock.json`](tools.lock.json) (xPack arm-none-eabi-gcc 15.2.1-1.1,
Renode 1.17.0) into the gitignored `.tools/` directory. Delete that
directory to remove them. Stop the server with **Ctrl+C**, which also shuts
down Renode cleanly.

> [!WARNING]
> The server is a **local, trusted, single-user** tool. It binds to
> `127.0.0.1` only. Compilation and execution are time- and size-limited
> child processes but **not sandboxed**, so run only code you trust. See
> [`SECURITY.md`](SECURITY.md).

## Firmware examples

| Example | Shows |
|---|---|
| [`gpiof-red-led`](examples/gpiof-red-led/main.c) | **A** — clock enable + PRGPIO wait, PF1 output HIGH → red LED on |
| [`gpiof-led-off`](examples/gpiof-led-off/main.c) | **B** — identical configuration, DATA LOW → LED off |
| [`gpiof-blink`](examples/gpiof-blink/main.c) | **C** — masked DATA alias + software delay blink |
| [`sw1-red-led`](examples/sw1-red-led/main.c) | **D** — SW1 active-low input with internal pull-up, polled |
| [`switch-interrupts`](examples/switch-interrupts/main.c) | **E** — PF0 unlock, falling-edge GPIO interrupts, NVIC IRQ 30, ISR |
| [`external-led-button`](examples/external-led-button/main.c) | **F** — external LED (PA7 + 220 Ω) and pushbutton (PA6 → GND) wired in the workspace ([`diagram.json`](examples/external-led-button/diagram.json)) |
| [`systick-blink`](examples/systick-blink/main.c) | **G** — RCC2/PLL to 50 MHz, SysTick interrupt every 100 ms toggles PF3 |
| [`timer1a-prescaled`](examples/timer1a-prescaled/main.c) | **H** — TIMER1A 16-bit periodic, prescaler 256: 0.3355 s timeouts toggle PF2 |
| [`three-timers`](examples/three-timers/main.c) | **I** — TIMER0A/1A/2A 32-bit periodic at 250/500/1000 ms on PF1/PF2/PF3 |
| [`lab-gpio-interrupts`](examples/lab-gpio-interrupts/main.c) | **J** — Experiment 6 style with `TM4C123.h`: `GPIOF->…`, `NVIC->IP`, `NVIC_EnableIRQ(GPIOF_IRQn)` |
| [`lab-systick-timer`](examples/lab-systick-timer/main.c) | **K** — Experiment 7 style with `TM4C123.h`: `SysTick_Config(SystemCoreClock / 10)`, `TIMER1->…` |
| [`lcd1602-hello`](examples/lcd1602-hello/main.c) | **L** — Experiment 8: LCD1602 4-bit on Port B (RW tied to GND), CGRAM character, SysTick `COUNTFLAG` delays ([`diagram.json`](examples/lcd1602-hello/diagram.json)) |
| [`adc-potentiometer`](examples/adc-potentiometer/main.c) | **M** — Experiment 9: ADC0 SS3 reads a potentiometer on PE3/AIN0 (workspace knob, [`diagram.json`](examples/adc-potentiometer/diagram.json)); LED colour follows the code |
| [`adc-temperature`](examples/adc-temperature/main.c) | **N** — Experiment 9: internal temperature sensor on ADC1 SS3 with `ADC1SS3_Handler`; die temperature set in the workspace (select U1) |

Negative fixtures (missing clock / DIR / DEN, compile and link errors,
unsupported accesses) are in [`tests/fixtures/firmware/`](tests/fixtures/firmware/).

## Tests and evidence

```bash
npm test       # compiler, Renode integration, API, workspace model, netlist, board/pin map
npm run test:e2e   # browser: firmware-driven LEDs, switches, reset, editor, wiring, zoom, diagram.json
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs both suites
on every push with the pinned toolchains, reports failures as annotations,
and publishes the browser screenshots to the
[`ci-artifacts`](https://github.com/Khaledbaniodeh/TM4C123-simulator/tree/ci-artifacts)
branch. [`hardware-reference.yml`](.github/workflows/hardware-reference.yml)
checks the board model against TI's documents.

Results, gate-by-gate evidence, and known limitations are in the
[**RISK-001 Acceptance Report**](docs/RISK-001_Acceptance_Report.md). Some
highlights it documents:

- Examples A and B differ only in the DATA value and produce different pin
  states.
- Firmware without `RCGCGPIO` takes a **precise bus fault → HardFault** with
  `BFAR = 0x40025400`, as documented for the silicon.
- Reset returns pins to reset state, and the CPU restarts from the vector
  table.
- Two runs of the blink firmware produce identical edge timestamps.

## Limitations

- No container isolation yet. Local trusted use only.
- Only the 16 MHz PIOSC reset clock. PLL/RCC are not modeled, and timing is
  approximate (one instruction per cycle at 16 MIPS).
- Interactive runs are slower than real time on Windows (0.1–0.8× measured).
- Peripherals beyond SYSCTL/GPIO are placeholders.
- **No comparison with physical hardware has been performed.**

## Roadmap

Next: UART0 + virtual terminal (Exp. 10) → logic analyzer → container
worker. See [`ROADMAP.md`](ROADMAP.md) and
[`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Repository layout

```text
apps/orchestrator/   Node.js server: compiler runner, Renode session, HTTP/SSE API
apps/web/            Browser workspace (no build step)
simulator/firmware/  Startup, linker script, device header (include/), SystemInit
simulator/renode/    Renode platform (.repl) and C# peripheral models
examples/            Firmware examples A–N
tests/               Node test suites + negative firmware fixtures
e2e/                 Playwright browser tests
docs/                Architecture, decisions, models, events, reports
```

## Contributing and feedback

Technical review is very welcome, especially on silicon behavior, timing
fidelity, and test programs to validate against real hardware. The specific
questions are in [`docs/TECHNICAL_OVERVIEW.md` §8](docs/TECHNICAL_OVERVIEW.md#8-where-expert-feedback-would-be-most-valuable).
See [`CONTRIBUTING.md`](CONTRIBUTING.md) and [`HELP_WANTED.md`](HELP_WANTED.md).

## Disclaimer

An independent project. It is **not affiliated with, sponsored by, or
endorsed by Texas Instruments**, Antmicro/Renode, Wokwi, or any university.
TM4C123, Tiva, and LaunchPad are trademarks of their respective owners.
Register behavior is implemented from public datasheet descriptions.
Simulation results are not a substitute for testing on hardware.
