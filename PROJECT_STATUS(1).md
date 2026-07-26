# Project Status

**Current status:** Planning / Temporarily Paused  
**Usable simulator available:** No  
**Public release available:** No

## What Has Been Completed

- MVP scope documented.
- Required components documented.
- Laboratory examples documented.
- Register and peripheral compatibility matrix documented.
- High-level architecture documented.
- Feasibility spike broken into small tasks.
- Initial environment check completed.

## What Has Not Been Implemented

- ARM compiler integration.
- ELF loading.
- Cortex-M4 execution.
- TM4C123 custom peripheral models.
- GPIO simulation.
- Board renderer.
- Component renderer.
- Wiring system.
- LCD1602 simulation.
- ADC simulation.
- Logic analyzer.
- Complete browser application.

## Current Blockers

The next technical milestone requires a suitable environment with:

- Docker or equivalent process isolation.
- `arm-none-eabi-gcc`.
- Renode or another approved Cortex-M4 execution engine.
- Sufficient disk space.
- Stable CI or local runner access.
- Permission to run isolated build and simulation workers.

## Next Technical Milestone

```text
C source
→ Cortex-M4 ELF
→ execution engine
→ TM4C123 SYSCTL/GPIOF MMIO
→ effective PF1 output
→ browser red LED
```

## Important Clarification

The repository currently contains planning and architecture documents. It should not be described as a working simulator until the first end-to-end execution milestone passes and is reviewed.

## Status Table

| Area | Status |
|---|---|
| MVP scope | Complete |
| Compatibility matrix | Complete |
| Architecture design | Complete |
| Feasibility plan | Complete |
| Development environment | Not ready |
| Compiler integration | Not started |
| Execution engine integration | Not started |
| GPIO model | Not started |
| Browser proof | Not started |
| Full simulator | Not available |
