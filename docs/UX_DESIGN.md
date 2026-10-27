# Interface design: layout, interaction model, design system

This describes the interface after the 2026 redesign: why it changed, how it
is organised, and where it stands against Wokwi, which served as a
usability benchmark. The simulator, router, netlist, `diagram.json` format
and browser drafts did not change. Everything below is checked by browser
tests at 1024×768, 1280×720 and 1920×1080 (`e2e/ux-*.spec.js`,
`e2e/layout.spec.js`, `e2e/toolbar.spec.js`).

## What was wrong

Measured on `main` before the redesign, at 1280×720 a student's screen
gave the circuit 565×371 px, about 23% of the window. Six bands stacked
above and below it:

- a two-line header;
- a full-width notice bar;
- a 64 px simulator header that repeated the board's name;
- a 13-button toolbar;
- an inspector column (selection, pins, ELF, capability list) that was
  always open;
- a console with six filter controls, also always open.

Every control was always visible, and nothing marked what to do first. The
editor was plain monochrome text. The library was a flat list of names.
While a wire was being drawn, the canvas did not show which pins could be
targets.

## Layout

```
┌ top bar ─────────────────────────────────────────────────────────────────────┐
│ M4 TM4C123 Simulator │ Example ▾ │ Compile ▶ Run ❚❚ ↻ ■ │ ● Running 1.2 s │ ? │
├ code ───────────────┬┬ circuit ──────────────────────────────────────────────┤
│ main.c  [Built]     ││ [+ Add Part] ↶ ↷ │ ⟳ ⧉ 🗑 │ − 141% + ⤢ ⊞ ⋓ │   ⤓ ⤒ │ ▣ │
│ About this example… ││                                          │ Inspector │
│  1 #include …       ││        canvas: board, parts, wires       │ ▾ Selection│
│  2 …  (coloured C)  ││                                          │ ▾ Pins     │
│                     ││                                          │ ▸ Firmware │
├─────────────────────┴┴──────────────────────────────────────────┴───────────┤
│ Console  Problems 0  Events 0 │ newest message…                         ⌃ │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⛨ Local trusted mode: not sandboxed — only run code you trust · GCC · Renode │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Top bar:** the project (example), the simulation controls in one fixed
  group, the state pill (status, virtual time, real-time factor) and Help.
  Compile and a prominent green Run carry text labels; Pause, Reset and
  Stop are labelled icons. No control appears or disappears with the
  state, so nothing moves under the pointer when Run is pressed.
- **Code | circuit:** a split with a keyboard-accessible, resizable
  splitter, remembered per browser (double-click resets it). The code pane
  gets 34% of wide screens and 36% below 1280 px.
- **Circuit toolbar:** one row from 1024 px up. Add Part is the primary
  action, and every tool's tooltip names its shortcut.
- **Inspector:** an accordion of Selection, live Pins, Firmware image (the
  ELF) and Simulator coverage.
  - It is open from 1280 px.
  - On narrower screens it opens when a part is selected, but only after
    the press is released, so a drag is never disturbed. It stays closed if
    the user has hidden it.
- **Output:** folded to one line showing the newest message. A tab opens
  it, and build problems and errors open it by themselves. The filters
  appear only when it is open.
- **Status bar:** the trust notice, always visible on one line; the
  independence disclaimer; the session state.

Measured canvas size, before → after (CI, same tests):

| Window | Before | After | Area |
|---|---|---|---|
| 1024×768 | 584×356 | 648×612 | +91% |
| 1280×720 (inspector open) | 565×371 | 554×564 | +49% |
| 1920×1080 | 987×701 | 976×924 | +30% |

## Interaction model

- **First run:**
  - A pointer to Run, which never takes a click and disappears after the
    first Compile, Run or Help.
  - Canvas hints while the circuit is the bare board, shown where there is
    room beside it.
  - A Help panel (`?`) with five first steps and every keyboard shortcut.
- **A bare board** is framed with a workbench to its right. New parts land
  beside the board, next to the J4/J2 headers, never on it.
- **Library:** opened by Add Part or `A`.
  - The search box has focus as soon as it opens.
  - Parts are grouped (Outputs, Inputs, Passive, Displays, Instruments).
    Each shows its own artwork with its pins, a two-line description, and
    whether it is *simulated* or *editor only*.
  - Arrow keys and Enter choose a part. A search with no match names the
    supported parts.
  - A part just added glows briefly.
- **Wiring:** click or drag from pin to pin, as before. While a wire is
  drawn, every pin shows as a target, the starting pin is marked green and
  a hovered target brightens. Routing (D-035), rerouting by dragging a
  segment, and validation are unchanged.
- **Editor:** a textarea, with C syntax colouring drawn under its
  transparent text (`c-highlight.js`). Caret, selection, Tab, F8/Shift+F8
  and the problem marks work as before.
- **Shortcuts added:**
  - `Ctrl+Enter` runs.
  - `Ctrl+B` compiles.
  - `A` adds a part.
  - `?` opens Help.

  All existing keys are unchanged: `R`, `Del`, the arrow keys, `Ctrl+Z`/`Y`,
  `Ctrl+C`/`X`/`V`/`D`/`A`, `+`/`−`, `F`/`0`, `G`, `Esc`.

## Design system

`styles.css` defines tokens on `:root`. Older token names stay as aliases
for the workspace and board stylesheets.

- **Surfaces:** `--surface-0` … `--surface-4`, plus borders.
- **Text:** `--text`, `--text-soft`, `--text-muted`.
- **Roles:**
  - `--accent`: blue, for selection, focus and Add Part.
  - `--run`: green, for Run.
  - `--danger`, `--warning`, `--success`.
- **Spacing:** `--space-1` … `--space-5`, in steps of 4 px.
- **Radii:** 6, 8 and 12 px.
- **Type:** `--font-ui` (Inter / system UI) and `--font-code` (Cascadia
  Code / JetBrains Mono / Consolas).
- **Sizes:** `--control-h` 32 px, `--toolbar-h` 42 px, `--topbar-h`
  52 px, `--statusbar-h` 26 px.

Buttons come in one family: `.btn` (secondary), `.btn-run`, `.btn-accent`,
`.btn-icon`, `.btn-stop`, and `.icon-button` for 30 px tools. Tool icons are
16 px monochrome SVGs stroked in the button's colour. Every control has a
visible keyboard focus ring.

The identity is the red M4 mark on a dark engineering theme, with blue for
interaction and green for Run. It is deliberately not Wokwi's colours or
layout.

## Decisions

- **Textarea plus colouring, not CodeMirror.** The project serves plain ES
  modules with no bundler. CodeMirror 6 would add a vendored build of a few
  hundred KB. It would also replace the editing model that problem
  navigation, drafts and many tests rely on. Colouring gives most of the
  readability benefit with no dependency.
  - Not available as a result: autocomplete, multiple cursors, and
    find/replace beyond the browser's own.
- **A docked inspector, not a floating panel.** A floating card would cover
  pins and parts near it, and could take their clicks. On narrow screens
  the docked inspector opens only after the press is released.
- **The output panel folded by default.** The circuit gets the height;
  errors can't be missed, because they open the panel.
- **Layout logic in `layout.js`.** It is separate from `app.js`, which
  keeps the simulation session; it holds no simulation state.

## Against Wokwi

The benchmark was Wokwi's public diagram-editor documentation and its
editor as it appears when opened. Wokwi's compile-error view was not
observed: its build queue was long and the build was cancelled. This is
not a claim of parity.

| Area | Wokwi | TM4C123 Simulator | Gap |
|---|---|---|---|
| First view | Code and simulation, about half each; three floating buttons (Play, Add, More) | Code and circuit split; Run, Add Part and Help prominent; a first-run pointer; Help | Comparable after the redesign |
| Canvas | About half the window | 43–63% of the width, 78–86% of the height | Comparable; the inspector costs width at 1280 px |
| Finding parts | Searchable categorised menu with pictures; hundreds of parts | Searchable grouped library with artwork; 6 parts | **Missing:** breadth. Deliberate: only parts the simulator models honestly |
| Placing parts | Added at (0, 0), then dragged | Placed in free visible space beside the board, then dragged | — |
| Moving and editing parts | Drag, arrow keys, R, D, Shift multi-select, copy/paste | Drag, arrow keys (Shift ×10), R, Ctrl+D, Shift-click or box select, Ctrl+C/X/V, undo/redo | Duplicate is Ctrl+D here, D there |
| Wires | Click pin to pin; click to add waypoints; colour keys 0–9 and letters; double-click deletes | Click or drag pin to pin, automatic routes clear of pads, drag a segment to reroute, colour in the inspector, every target shown while wiring | **Missing:** waypoints while drawing, colour keys, double-click delete |
| Run and Stop | Play, Pause, Stop and Restart; time and speed shown | Compile, Run, Pause, Reset and Stop; virtual time and real-time factor; local builds | Comparable |
| Code editor | Monaco: completion, multiple cursors, format, several files, library manager | Textarea with colouring, line numbers, Tab, problem marks, F8 | **Missing:** completion, multiple cursors, several files. Not applicable: Arduino libraries |
| Errors | F8/Shift+F8 documented (view not observed) | Problems list from GCC and the linker; jump to line and column; gutter marks; the output opens by itself | — |
| Save and share | Cloud projects, share links, download | Automatic drafts in the browser; Save/Load `diagram.json` | **Unsupported by design:** sharing and hosting (local trusted mode, see SECURITY.md) |
| Other features | Wi-Fi, serial monitor, logic analyzer, custom chips, GDB, VS Code | UART planned (Experiment 10); logic analyzer is editor only | **Unsupported or planned** |

## Remaining limitations

- At 1280×720 the inspector, while open, takes 284 px from the canvas. The
  user can hide it, and the setting is remembered.
- The bare-board view shows the board smaller than a tight frame would,
  to leave room for parts. Fit (`F`) after adding parts frames the circuit
  tightly.
- The first-run canvas hints show only when the canvas is wider than
  700 px. Help and the Run pointer cover narrower screens.
- The canvas is driven by pointer. Keyboard users can nudge, rotate,
  delete and duplicate, but cannot draw wires from the keyboard.
- The editor has no completion or find/replace; see Decisions.
