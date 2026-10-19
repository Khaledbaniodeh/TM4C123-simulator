# Runtime Events

Structured events are the only channel through which simulated hardware
state leaves the execution engine (decision D-019). The browser derives the
board view exclusively from these events.

## Transport

```text
C# peripheral models ──JSON lines──▶ $TM4C_EVENT_LOG (per-session file)
                                         │  tailed by renode-session.js
CPU fault registers ──Renode Monitor──▶ orchestrator
                                         │
                                         ▼
                       Server-Sent Events: GET /api/sessions/:id/events
```

## Common fields (model events)

| Field | Type | Meaning |
|---|---|---|
| `type` | string | Event kind (below) |
| `sequence` | integer | Strictly increasing within one Renode process |
| `virtualTimeNs` | string | Emulation virtual time in nanoseconds (decimal string, 64-bit safe) |

Timestamps are synchronized at translation-block boundaries, so two writes a
few instructions apart can share a timestamp. At the configured 16 MIPS one
instruction is 62.5 ns.

## Model event types

| Type | Emitted by | Key fields |
|---|---|---|
| `port-snapshot` | GPIO, on power-on and reset | `peripheral`, `cause` (`power-on`/`reset`), `pins[]` {`pinId`, `level`, `state`, `drive`} |
| `digital-pin-changed` | GPIO, only when a pin's resolved state changes | `pin` {`partId`, `pinId`}, `level` (1/0/null), `state` (`high`/`low`/`floating`/`conflict`), `drive` (`output`/`pull-up`/`pull-down`/`external`/`conflict`/`none`) |
| `clock-gate-changed` | SYSCTL | `peripheral` (e.g. `GPIOF`, `TIMER1`), `enabled` |
| `system-clock-changed` | SYSCTL, on reset and whenever RCC/RCC2 change the clock | `hz`, `source` (`PIOSC`, `MOSC`, `PLL(MOSC)`, …), `pll`, `divisor`, `cause` (`reset`/`clock-register`/`pll-powered`) |
| `clock-configuration-warning` | SYSCTL | `detail`, `rcc`, `rcc2` — e.g. above 80 MHz, PLL selected while powered down |
| `timer-started` | GPTM, when `TnEN` is set | `peripheral` (e.g. `TIMER1A`), `width` (16/32), `mode`, `direction`, `intervalLoad`, `prescale`, `periodClocks`, `clockHz` |
| `interrupt-line-changed` | GPIO, GPTM (`TIMERnA`/`TIMERnB`) | `peripheral`, `asserted`, `mis` |
| `bus-fault` | GPIO, GPTM (unclocked access) | `peripheral`, `address`, `access`, `value`, `reason` |
| `unsupported-register-access` | SYSCTL, GPIO, GPTM | `peripheral`, `address`, `offset`, `access`, `value`, `reason` |
| `unimplemented-peripheral-access` | Placeholder regions (UART, wide timers, ADC, …) | `peripheral`, `address`, `access`, `reason` — first access per register/direction |
| `unsupported-feature` | GPIO (AFSEL, AMSEL, ADC/DMA triggers), GPTM (capture, PWM, RTC, …), SYSCTL (`clock-propagation`) | `peripheral`, `feature`, `detail` |
| `commit-protected-write-ignored` | GPIO (GPIOCR) | `peripheral`, `register`, `bits`, `reason` |
| `locked-register-write-ignored` | GPIO (GPIOLOCK) | `peripheral`, `register`, `value` |
| `floating-input-read` | GPIO | `peripheral`, `bits`, `reason` |

## Orchestrator-generated events

| Type | Source | Key fields |
|---|---|---|
| `cpu-fault` | SCB registers after a run step | `exception` (`HardFault`, …), `pc`, `cfsr`, `hfsr`, `bfar` (only if BFARVALID) |

## Session messages (SSE envelope)

| `type` | Meaning |
|---|---|
| `simulator-event` | Wraps one event above in `event` |
| `session-status` | `state` (`starting`/`paused`/`running`/`stopped`/`error`), `virtualTimeNs`, optional `realTimeFactor`, `message` |
| `mcu-reset` | `machine Reset` completed |
| `board-input` | SW1/SW2 pressed or released |
| `engine-log` | Renode warning/error text — display only |
| `session-limit` | Wall-time or virtual-time limit reached |

## Example

```json
{"type":"clock-gate-changed","sequence":7,"virtualTimeNs":"625","peripheral":"GPIOF","enabled":true}
{"type":"digital-pin-changed","sequence":8,"virtualTimeNs":"1500","pin":{"partId":"board1","pinId":"PF1"},"level":0,"state":"low","drive":"output"}
{"type":"digital-pin-changed","sequence":9,"virtualTimeNs":"1500","pin":{"partId":"board1","pinId":"PF1"},"level":1,"state":"high","drive":"output"}
```
