# Support

## Project Status

This project is currently in the planning and feasibility stage.

There is no stable release, hosted simulator, or finished application available yet.

Support is currently focused on:

- Architecture questions.
- Documentation clarification.
- Development environment blockers.
- Contribution proposals.
- Future implementation tasks.

---

## Where to Ask for Help

Use GitHub Issues for:

- Questions about the project architecture.
- Problems with a documented task.
- Environment or toolchain blockers.
- Requests to contribute.
- Documentation corrections.
- Reproducible problems with implemented code.

Before opening an issue, check:

- `README.md`
- `PROJECT_STATUS.md`
- `ROADMAP.md`
- `CONTRIBUTING.md`
- `HELP_WANTED.md`
- Documents inside the `docs/` directory.

---

## Information to Include

When requesting technical help, include:

- Related task ID.
- Related document.
- Operating system.
- Tool versions.
- Exact commands executed.
- Exact output or error message.
- Expected result.
- Actual result.
- What you already tried.
- Screenshots or logs where useful.

Example:

```text
Task: R1A-1
Operating system: Windows 11 x64
Node.js: v24.13.1
Command: docker --version
Result: docker command not found
```

Avoid summaries such as:

```text
It does not work.
```

Provide the exact failure instead.

---

## Questions That Are Welcome

You may open an issue for:

- TM4C123 register behavior.
- ARM Cortex-M4 firmware execution.
- Renode integration.
- Compiler sandboxing.
- React and TypeScript architecture.
- GPIO, ADC, timers, or LCD modeling.
- Testing and CI/CD.
- Infrastructure or environment recommendations.
- Requests to claim a small project task.

---

## Out-of-Scope Support

Please do not use this repository for:

- General homework unrelated to this project.
- Requests for a finished simulator download.
- Questions about unsupported microcontrollers.
- Requests to add unrelated boards without an approved scope change.
- Private or sensitive information.
- Claims that an unfinished feature should already work.
- Requests to bypass security or sandbox restrictions.

---

## Bug Reports

The project does not currently have a usable release.

Bug reports should only be opened for behavior that has actually been implemented in the repository.

When reporting a bug, include:

1. The affected task or module.
2. The commit SHA.
3. Exact steps to reproduce.
4. Expected behavior.
5. Actual behavior.
6. Exact commands and output.
7. Screenshots or logs.

Do not report planned but unimplemented functionality as a bug.

---

## Security Issues

Do not publish sensitive security details in a normal GitHub Issue.

For issues involving:

- Sandbox escape.
- Arbitrary command execution.
- Unauthorized file access.
- Network access from isolated workers.
- Cross-session data access.
- Secret or credential exposure.

Follow the instructions in:

```text
SECURITY.md
```

---

## Response Expectations

This is currently an independent and community-driven project.

There is no guaranteed support response time.

Responses may depend on:

- Maintainer availability.
- Contributor availability.
- Technical complexity.
- Access to suitable development resources.
- Whether the issue includes enough reproducible information.

---

## Current Support Limitations

At the current project stage:

- The simulator cannot be run.
- There is no production deployment.
- There is no stable API.
- There is no official release.
- There is no guaranteed compatibility.
- There is no guaranteed support schedule.

These limitations will be updated as implementation progresses.

---

## Best Way to Help

The most useful support is currently:

- Reviewing architecture documents.
- Verifying TM4C123 register details.
- Helping provision a suitable execution environment.
- Reviewing the RISK-001 feasibility plan.
- Contributing to one small, approved task.
- Providing CI, storage, or compute guidance.

Thank you for helping the project progress carefully and honestly.
