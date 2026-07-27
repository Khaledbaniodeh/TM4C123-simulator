# Security Policy

## Project Status

This project is currently in the planning and feasibility stage.

There is no stable release, hosted simulator, or production service available yet.

---

## Reporting a Security Issue

Please do not open a public GitHub Issue for vulnerabilities involving:

- Arbitrary command execution.
- Compiler sandbox escape.
- Simulation worker escape.
- Unauthorized filesystem access.
- Network access from an isolated worker.
- Path traversal.
- Cross-session data access.
- Leakage of user source code.
- Leakage of build artifacts.
- Resource-limit bypass.
- Exposure of credentials or secrets.

Use GitHub's private vulnerability reporting feature if it is available for this repository.

If private reporting is unavailable, contact the repository owner privately and provide only the information required to explain the issue safely.

---

## High-Risk Areas

Future implementation must treat the following as security boundaries:

- User-provided C source code.
- Uploaded project files.
- Compiler workers.
- Cortex-M4 execution workers.
- Temporary build directories.
- ELF firmware artifacts.
- Runtime event streams.
- WebSocket or SSE sessions.
- Artifact storage.
- CI secrets and credentials.
- Container and process isolation.

---

## Compiler Security Requirements

The compiler environment must use:

- No outbound network access by default.
- A read-only base filesystem.
- A temporary isolated working directory.
- CPU limits.
- Memory limits.
- Process and PID limits.
- Wall-clock timeouts.
- Source-file count limits.
- Source-size limits.
- Build artifact-size limits.
- Fixed compiler arguments.
- No user-controlled shell arguments.
- No shell interpolation of user input.
- Guaranteed cleanup after success or failure.

User source code must be treated as untrusted input.

---

## Execution Security Requirements

Every firmware simulation session must use:

- An isolated execution worker.
- No outbound network access.
- CPU and memory limits.
- Process and PID limits.
- Maximum wall-clock duration.
- Maximum virtual execution duration.
- Temporary isolated storage.
- Read-only firmware and platform inputs where possible.
- Forced termination on timeout.
- Guaranteed cleanup.
- No shared mutable state between users or sessions.

---

## API Security Requirements

The backend must validate:

- Source-file paths.
- Project-file size.
- Source-file count.
- Source-file size.
- Session ownership.
- Input-event values.
- Runtime message size.
- Artifact references.
- WebSocket or event-stream session identity.
- High-frequency input rate limits.

Path traversal attempts such as:

```text
../
```

must be rejected.

---

## Sensitive Information

Do not commit:

- Passwords.
- API keys.
- Access tokens.
- Private certificates.
- CI secrets.
- Personal user data.
- Private source code from users.
- Temporary firmware artifacts containing sensitive data.

Use environment variables or approved secret-management systems for future deployment secrets.

---

## Supported Versions

No version is currently supported because the project does not yet have a usable release.

This section will be updated when versioned releases become available.

| Version | Supported |
|---|---|
| Planning documents | Documentation only |
| Development builds | Not yet available |
| Public release | Not available |

---

## Security Principle

The project must never trade isolation or user safety for development speed.

A feature that cannot run safely should remain disabled until its security requirements are implemented and tested.
