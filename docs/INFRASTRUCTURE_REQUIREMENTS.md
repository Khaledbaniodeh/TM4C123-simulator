# Infrastructure Requirements

This document describes the technical environment required to continue development of the TM4C123 Educational Web Simulator.

It is not a fundraising request.

The project is seeking technical guidance, suitable development resources, CI-runner access, and infrastructure collaboration.

---

## Current Situation

The planning, compatibility analysis, architecture, and feasibility-spike design have been documented.

Implementation is temporarily paused because the next phase requires tools and resources that are not currently available in the selected development environment.

The current environment does not yet provide:

- Docker.
- ARM GNU Embedded Toolchain.
- `arm-none-eabi-gcc`.
- Renode.
- Sufficient verified storage for toolchains and container images.
- A stable isolated execution runner.

---

## Why Infrastructure Is Required

The simulator is intended to execute real user-provided C firmware.

The required flow is:

```text
User C source
→ isolated ARM compilation
→ ELF firmware
→ Cortex-M4 execution
→ TM4C123 peripheral models
→ browser-visible hardware state
```

This requires more than a normal frontend development environment.

Both compilation and firmware execution must be isolated because user-provided source code is untrusted.

---

## Minimum Development Environment

### Operating System

Preferred:

```text
Linux x86_64
```

Acceptable alternatives:

- Windows with WSL2.
- A Linux virtual machine.
- A suitable cloud or CI runner.
- A dedicated development server.

---

## Required Software

### Core Tools

- Git.
- Node.js.
- npm.
- Docker or an equivalent container runtime.
- ARM GNU Embedded Toolchain.
- `arm-none-eabi-gcc`.
- `arm-none-eabi-objdump`.
- `arm-none-eabi-readelf`.
- Renode.
- Python for automation and tests.
- .NET/C# tooling where required for Renode peripherals.

### Future Frontend Tools

- React.
- TypeScript.
- Browser-testing tools.
- A suitable code editor component.
- WebSocket or event-stream support.

---

## Storage Requirements

The development environment should have enough free storage for:

- Docker images.
- ARM compiler toolchains.
- Renode.
- Build artifacts.
- Temporary compilation directories.
- Simulation workers.
- Test fixtures.
- CI caches.
- Browser dependencies.

### Recommended Free Space

```text
Minimum practical target: 20 GiB
Preferred development target: 30–50 GiB
```

The exact usage will depend on the selected container images and build strategy.

---

## Memory Requirements

### Minimum

```text
8 GB RAM
```

### Preferred

```text
16 GB RAM or more
```

Additional memory is useful when running:

- Docker Desktop.
- WSL2 or a virtual machine.
- Renode.
- Multiple isolated simulation workers.
- Frontend development tools.
- Automated browser tests.

---

## Processing Requirements

The environment should provide:

- A modern 64-bit processor.
- Hardware virtualization support where Docker or virtual machines require it.
- At least 4 logical CPU cores.
- Preferably 8 logical CPU cores or more.

The project does not require specialized GPU hardware.

---

## Network Requirements

Development and CI environments require outbound HTTPS access for:

- GitHub.
- Package registries.
- Docker image registries.
- Toolchain downloads.
- Renode packages.
- npm dependencies.

Compilation and firmware execution workers should run with:

```text
No outbound network access
```

Network access is needed for environment provisioning, but should be disabled inside untrusted-code sandboxes.

---

## Isolation Requirements

### Compiler Worker

The compiler worker must provide:

- No outbound network.
- Read-only base filesystem.
- Temporary writable directory.
- CPU limits.
- Memory limits.
- Process limits.
- Wall-clock timeout.
- Source-size limits.
- Artifact-size limits.
- Guaranteed cleanup.

### Simulation Worker

The execution worker must provide:

- No outbound network.
- CPU and memory limits.
- Maximum execution duration.
- Process limits.
- Temporary isolated storage.
- Forced cleanup.
- No shared mutable state between sessions.

---

## CI Runner Requirements

A suitable CI runner should be capable of:

- Building the frontend and backend.
- Running TypeScript tests.
- Compiling Cortex-M4 fixtures.
- Launching Renode headlessly.
- Running peripheral tests.
- Running security and isolation tests.
- Running selected end-to-end browser tests.
- Storing bounded test artifacts and logs.

The initial CI workload may be small, but it should support future isolated integration tests.

---

## Current Priority

The immediate priority is not the full simulator.

The first required milestone is:

```text
C source
→ Cortex-M4 ELF
→ execution engine
→ TM4C123 SYSCTL/GPIOF MMIO
→ PF1 output event
→ browser red LED
```

A suitable environment only needs to support this feasibility spike first.

---

## Ways Contributors Can Help

Technical contributors may help by providing:

- Environment setup guidance.
- Docker and WSL2 configuration review.
- A temporary Linux runner for the feasibility spike.
- CI configuration.
- Toolchain version recommendations.
- Renode setup and platform guidance.
- Storage and resource planning.
- Security review of compiler and execution isolation.
- Reproducible setup scripts.

Contributors do not need to provide permanent hosting or financial support.

A small, reproducible environment suitable for the first feasibility spike would already be valuable.

---

## Important Clarification

This document does not indicate that the project is production-ready.

It describes the infrastructure required to begin implementation safely and reproducibly.

No public service, hosted simulator, or stable release currently exists.
