# Company demo: 2-minute recorded walkthrough

A 90–120 second video of the real simulator for software and embedded
engineering audiences, recorded by GitHub Actions in one continuous take.
The full 10-minute live script is [`docs/SHOWCASE_DEMO.md`](../docs/SHOWCASE_DEMO.md).

## Get the video

Actions → **Demo video** → latest successful run → artifact
**`tm4c123-simulator-demo-video`**:

| File | What it is |
|---|---|
| `tm4c123-simulator-demo.mp4` | 1920×1080 H.264, 30 fps, silent: for a live voice-over |
| `tm4c123-simulator-demo-captioned.mp4` | The same take with the voice-over text burned in: for sharing |
| `tm4c123-simulator-demo.srt` | The voice-over as subtitles, timed to the take |
| `timeline.json` | When each scene started and when each frame was painted |

Artifact **`tm4c123-simulator-demo-stills`** has one frame per scene, for a
quick check without playing the video. To record a new take: Actions → Demo
video → **Run workflow** on `main` (it also runs when `demo/` changes).

## How it is made (what is real)

- **One take of the real app:** the pinned `arm-none-eabi-gcc` 15.2.1 builds
  the firmware, and Renode 1.17.0 executes the ELF with the project's
  TM4C123 models. This is the same server and browser path the tests use.
  Pointer and keyboard input are real browser events.
- **Each scene waits for what it shows,** with the same checks as the
  showcase tests (`Built`, `Running`, PA7 HIGH while the button is held,
  `Hello, TM4C123!` on the LCD, the GCC error in Problems). A take finishes
  only if the app really did it.
- **Frames are what Chromium painted,** each shown from the moment it was
  painted until the next. Nothing is re-timed, sped up, cut, or animated. The
  waits for compiling and starting Renode are in the video as they happened.
- **Two additions, both disclosed:**
  - A drawn pointer, since headless frames have no cursor. It ignores all
    events.
  - The app's "Load example? This replaces your circuit changes" prompt is
    accepted, as a presenter would.
- **Captions** are the voice-over below, placed at the recorded scene times.
  The video has no audio track.

## Storyboard

Times are from the take recorded for PR #34 (1:56 in all). They vary by a
second or two between takes, since compiling and Renode start-up run at real
speed.

| # | Time | Scene | Example (ID) | On screen |
|---|---|---|---|---|
| 1 | 0:00 | LaunchPad workspace | I `three-timers` | Pointer over the board; hover J3 pin 10: PF1, on-board red LED, simulation state |
| 2 | 0:07 | Real C source | I `three-timers` | Scroll `main.c` to the three timer interrupt handlers |
| 3 | 0:14 | GCC compilation | I `three-timers` | **Compile** → `Built`; inspector **Firmware image**: ELF entry, `.isr_vector`, `.text` |
| 4 | 0:20 | Execution in Renode | I `three-timers` | **Run**: RGB LED toggled by TIMER0A/1A/2A interrupts; pin table and console update |
| 5 | 0:34 | Wiring | (I's board) | **Stop**; **+ Part → LED**; drag from J2.3 to the LED anode; wire created and routed |
| 6 | 0:44 | External button | F `external-led-button` | **Run**; hold the pushbutton: PA6 LOW, PA7 HIGH, external LED lit; release |
| 7 | 1:01 | LCD1602 | L `lcd1602-hello` | **Run**: `Hello, TM4C123!`, CGRAM heart, counter |
| 8 | 1:18 | ADC potentiometer | M `adc-potentiometer` | **Run**; select pot1; slider to 15 % (green), then 95 % (3.135 V on PE3, red) |
| 9 | 1:35 | Compiler diagnostics | M `adc-potentiometer` | Type a typo (`GREEN_LEDS`); **Compile** → Problems with GCC's "did you mean 'GREEN_LED'?"; click it → line 84; fix; `Built` |
| 10 | 1:47 | Console and limits | M `adc-potentiometer` | Console tab (severity, source, the build history); the trust notice |

## Voice-over script

About 235 words, roughly 1:45 at a calm pace. The same text is in
[`scenes.json`](scenes.json), which the captions are built from; there,
`sync` starts a sentence at the moment it describes (the LED lit, the error
listed), so captions never run ahead of the picture.

1. **Workspace.** This is the TM4C123 Simulator: TI's EK-TM4C123GXL
   LaunchPad, placed from TI's CAD data, in an interactive circuit workspace.
2. **Code.** The firmware is plain C written against the TM4C123 registers:
   three hardware timers, each with its own interrupt handler.
3. **Compile.** Compile runs the real arm-none-eabi-gcc toolchain. The
   inspector shows the resulting Cortex-M4 ELF and its sections.
4. **Run.** Run loads that ELF into Renode, which executes it on an emulated
   Cortex-M4 with the project's TM4C123 peripheral models. Three timer
   interrupts toggle the RGB LED; every pin change is a simulator event.
5. **Wiring.** Circuits are built by dragging from a header pin to a part;
   the wire is checked and routed clear of the other pins.
6. **Button.** Here the firmware polls an external pushbutton on PA6. Hold
   it: PA6 reads low, and the firmware lights the external LED on PA7.
7. **LCD.** An LCD1602 in 4-bit mode. The display shows only what the
   firmware's GPIO writes tell the HD44780 model: a greeting, a CGRAM heart,
   and a counter.
8. **ADC.** A potentiometer feeds ADC0 on PE3. Turn the knob: the voltage on
   PE3 changes, and the firmware switches the LED from green to red.
9. **Diagnostics.** Mistakes are reported as GCC reports them. The Problems
   list shows GCC's error and its suggestion, and jumps to the line. The fix
   rebuilds cleanly.
10. **Close.** The console lists every message with its severity and
    source. This runs locally in trusted mode; timing is approximate and not
    yet validated against physical hardware.

## Presentation checklist

**Before**
- [ ] Download the newest **Demo video** artifact. Watch both MP4s once,
      end to end.
- [ ] Choose the version: the captioned MP4 for a shared screen or a link;
      the clean MP4 if you narrate live.
- [ ] Rehearse the voice-over against the clean MP4 (about 1:45). The scene
      times are in the storyboard above.
- [ ] Have these open in tabs: the repository README (architecture), the
      latest green CI run (164 Node and 124 browser tests), and
      [`docs/SHOWCASE_DEMO.md`](../docs/SHOWCASE_DEMO.md) for a longer walkthrough.

**During**
- [ ] Say what is real: compiled C, a Cortex-M4 ELF, Renode execution, and
      peripheral models that report every register access and pin change.
- [ ] Say what the video is: one take recorded in CI, nothing sped up or cut.
      The pointer is drawn because the browser was headless.

**Say plainly (do not overclaim)**
- [ ] **Local, trusted, single-user tool.** Compilation and execution are not
      sandboxed, and there is no public hosted version
      ([`SECURITY.md`](../SECURITY.md), [`DEPLOYMENT_SECURITY.md`](../docs/DEPLOYMENT_SECURITY.md)).
- [ ] **Not compared with physical hardware yet.** The board layout comes from
      TI's CAD data, and CI checks all 40 header pins against SPMU296.
      Peripheral behaviour follows the datasheet and is verified by tests,
      not against a real LaunchPad.
- [ ] **Approximate timing.** One instruction per clock, not cycle-accurate.
      Interrupt + `WFI` firmware runs at about real time; firmware that polls
      a register runs well below it ([`PERFORMANCE.md`](../docs/PERFORMANCE.md)).
- [ ] **Not modeled yet:** UART (planned next), SSI, I2C, PWM, and the logic
      analyzer. Accesses to them are reported, never faked.

**Likely questions:** see "Questions to expect" in
[`docs/SHOWCASE_DEMO.md`](../docs/SHOWCASE_DEMO.md#questions-to-expect).

## Files

- [`record.spec.js`](record.spec.js): the take. Scene order, input, pacing,
  and the check behind each scene.
- [`scenes.json`](scenes.json): scene titles, examples, and the voice-over
  text.
- [`make-video.mjs`](make-video.mjs): frames → MP4, SRT, captioned MP4, and
  stills (needs ffmpeg).
- [`playwright.config.js`](playwright.config.js): runs only `record.spec.js`
  at 1280×720 × 1.5, so frames are 1920×1080. It is separate from the test
  suite.
- [`../.github/workflows/demo-video.yml`](../.github/workflows/demo-video.yml):
  installs the pinned toolchains, records, builds, and uploads.
