# Showcase Demo Script (≈ 10 minutes)

A guided walkthrough for presenting the simulator to engineers. Every step
uses supported, tested behavior; the same flow runs automatically in CI as
[`e2e/showcase.spec.js`](../e2e/showcase.spec.js), which also produces the
screenshots in [`docs/images/`](images/).

**Before the meeting.** Run `npm run setup:tools && npm ci && npm start`,
open <http://127.0.0.1:5123/> in a desktop browser (1280×720 or larger),
and click through steps 3 and 6 once so the toolchain is warm. To start
from a clean workspace, pick example **A** and, if asked, confirm replacing
the previous work.

## 1. The board (1 min)

- Point out the LaunchPad: placed from TI's SPMR240 CAD data, with all 40
  header pins checked in CI against the SPMU296 pinout.
- Hover **J3 pin 10**: the tooltip shows PF1, its on-board role (red LED)
  and its live simulated state.
- Mention the footer: independent project, hardware equivalence not
  verified. Honesty is part of the design.

## 2. Real C, real compiler (1 min)

- Example **A — Red LED on (PF1)** is plain C with register defines.
- Click **Compile**. The status turns **Built**; the inspector shows the
  ELF (entry point, `.isr_vector`, `.text`, `.data`, `.bss`) and the console
  shows the GCC build result. The notice bar names the exact GCC and Renode
  versions reported by the server.

## 3. Execution on the simulated MCU (1 min)

- Click **Run**. The console shows `SYSCTL: GPIOF clock enabled`, then
  `PF1 → HIGH (GPIO output)`, and the red LED lights.
- The pin table says why: PF1 HIGH, driven by a GPIO output. Nothing in the
  browser decides this; it is the GPIO model's event.
- Optional proof: example **B** has the identical configuration with DATA
  LOW, and the LED stays off.

## 4. Inputs: SW1 and an external button (1.5 min)

- Example **D**, **Run**, then hold **SW1**: PF4 reads LOW through the
  internal pull-up and the polling firmware lights the LED.
- Example **F**, **Run**, then hold the **external pushbutton**: PA6 goes
  LOW through the wired netlist, the firmware drives PA7 HIGH, and the
  external LED lights.

## 5. Building a circuit (2 min)

- Stop the simulation and pick example **A**.
- **+ Part → LED**: the LED is placed on free canvas beside the board.
- **Drag to connect:** press on **J2 pin 3**, drag to the LED's anode,
  release. The wire is created, validated and selected. **Ctrl+Z** removes
  it in one step; **Ctrl+Y** restores it exactly.
- **Pan while wiring:** click the LED's cathode to start a wire, then drag
  empty canvas (or use the middle button). The view moves and the wire stays
  attached; a plain click on empty canvas, or **Esc**, cancels it.
- Routes keep clear of unrelated pins: a wire from an inner header (J3, J4)
  first steps away from the neighbouring column. Drag any wire segment to
  reroute it by hand; that route is kept exactly.

## 6. LCD1602 (1 min)

- Example **L**, **Run**. The HD44780 model decodes the firmware's 4-bit
  writes on Port B: line 1 shows `Hello, TM4C123!`, line 2 a custom CGRAM
  heart and a counter.
- Talking point: the LCD has no text API; the firmware's GPIO writes are
  all it receives.

## 7. ADC and live pin information (1 min)

- Example **M**, **Run**. Select **pot1** and move its **Position** slider to
  about 95 %.
- The pin table shows PE3 as `3.135 V`, `pot1 → AIN0`: the circuit model's
  voltage, applied to the simulated ADC. The firmware converts it and
  switches the LED from blue to red.

## 8. Work is safe (1 min)

- Edit `main.c` (for example, add a comment) and add a part, then **reload
  the page**. The message says your main.c and circuit were restored from
  this browser.
- **Load** (keyboard: Tab to Load, Enter) a different `diagram.json`: the
  simulator asks before replacing your edited circuit; **Cancel** keeps
  everything, including undo history.

## 9. Close (30 s)

- Recap the pipeline: C → GCC → ELF → Renode → register models → events →
  browser, with deterministic virtual time.
- Be explicit about limits: local trusted mode only (no isolation yet), not
  compared with hardware, UART not modeled yet, approximate timing.

## Questions to expect

- *Is it cycle-accurate?* No: one instruction per clock at the configured
  system clock; see [`PERFORMANCE.md`](PERFORMANCE.md).
- *Can students use it online?* Not yet: the compile/execute backend needs a
  validated isolation design first ([`SECURITY.md`](../SECURITY.md)).
- *Is it compatible with Wokwi?* The `diagram.json` format is inspired by
  Wokwi's; full compatibility is not claimed.
