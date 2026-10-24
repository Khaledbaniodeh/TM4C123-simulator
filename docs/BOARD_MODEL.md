# EK-TM4C123GXL Board Model

The workspace draws the LaunchPad as structured, original SVG artwork. Every
physical fact below comes from TI's own documents. The `hardware-reference`
CI workflow extracts these facts on the GitHub runner. No TI file is
committed to the repository.

| Source | What it provides | Extracted by |
|---|---|---|
| **SPMR240**, EK-TM4C123GXL Rev A design package (PADS 9.3) | Board outline, part placement, drill coordinates | `tools/hwref/inspect_pads.py` |
| **SPMU296**, EK-TM4C123GXL User's Guide | J1–J4 connector tables (pin → GPIO) | `tools/hwref/check_pinmap.py` |
| Rev A schematic (in SPMR240) | LED and switch nets, R9/R10 | `grep` in the workflow |

## Verified facts

| Fact | Value | Evidence |
|---|---|---|
| Outline | 2000 × 2600 mil (50.8 × 66.04 mm) | PADS `*LINES*` BOARD outline and the BoardOutline Gerber agree |
| Header columns | J1 100, J3 200, J4 1800, J2 1900 mil | PADS `*PART*` (CON_110_100) |
| Header pin rows | Pin 1 at 1400 mil down to pin 10 at 500 mil, 100 mil pitch | NC drill tool T2 (0.035 in): 40 holes |
| J3/J4 inside J1/J2 | 0.1 in (2.54 mm) | SPMU296 text |
| Header pinout | All 40 pins match | `check_pinmap.py`: SPMU296 Tables 2-3 … 2-6 |
| R9 / R10 | 0 Ω links PD0↔PB6 and PD1↔PB7 ("for MSP430 compatibility") | SPMU296 J2/J3 rows, schematic |
| User switches | SW1 (400, 200) and SW2 (1600, 200) mil, Panasonic EVQ-Q2 footprint | PADS `*PART*` |
| RGB LED | D1 (1904, 1616) mil, driven through Q1–Q3 (DTC114E) | PADS `*PART*`, schematic LED_R/G/B |
| Target MCU | U1 (1000, 1000) mil, rotated 135° | PADS `*PART*` |
| Debug MCU (ICDI) | U2 (1200, 2230) mil | PADS `*PART*` |
| USB | J11 micro-B DEBUG on the top edge; J9 micro-AB DEVICE on the left edge | PADS `*PART*` |
| Power select | SW3 DPDT (200, 2400) mil | PADS `*PART*` |
| Power LED | D4 (772, 2200) mil | PADS `*PART*` |
| Tag-Connect | J5 TC2050 (bottom side); 3 × 0.039 in holes | PADS `*PART*` and drill tool T4 |
| Reset switch | `RESET` (SW-EVQQ2) at (1770, 1880) mil, right side above J4/J2 | PADS `*PART*` line `RESET SW-EVQQ2 …`; SPMU296 board figure ("Reset Switch") and §2.2.4 |

CAD values stay verbatim in `apps/web/board/launchpad.js` (mil, y axis up)
and are converted to SVG millimetres by one function, `cad()`. Header pins
land exactly on the workspace's 0.1 in snap grid.

## Interactive elements

| Element | Interaction | Status |
|---|---|---|
| 40 header pins | Hover tooltip (header pin, GPIO, alternate and analog functions, on-board role, R9/R10, live value); click to wire | GPIO pins **simulated** (Renode GPIO model); power/GND/RESET pins are wire endpoints |
| SW1 / SW2 | Press and hold while running (pointer or keyboard) | **Simulated**: drives PF4/PF0 through the GPIO model |
| RESET | Press and release while running | **Simulated**: Renode `machine Reset` on release |
| D1 RGB LED | Lights from `digital-pin-changed` events only | **Simulated** |
| D4 power LED | Lit while a session is live | Visual |
| U1, U2, J1–J4, J5, J9, J11, SW3, Y1/Y2/Y5, R9, R10 | Click to select; the inspector shows technical details and status | Labeled *simulated* or *visual only* per component |

Pin hit targets are drawn above wires, so connected pins stay reachable. They
keep a radius of about 7 screen pixels at every zoom level, clamped between
the pad size and half the pin pitch.

An earlier revision drew a *provisional* reset button on three holes near the
top-right corner. Those holes belong to J5's Tag-Connect footprint, and that
guess was removed. The first extraction pass missed the real part because its
reference designator, `RESET`, contains no digits. A wider pass found it, and
the switch is now drawn at its CAD position. Releasing it resets the simulated
MCU; holding the MCU *in* reset is not modeled.

## Not modeled

USB, the ICDI debug path, the power-select switch, the crystals and clock
tree, the Tag-Connect footprint, and LED brightness or current. These parts
are drawn for realism and labeled **visual only** in the inspector.
