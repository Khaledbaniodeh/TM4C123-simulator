# R1A-1 — Actual Workspace Environment Check

**Parent task:** R1A — Toolchain and Engine Pinning  
**Project:** TM4C123 Educational Web Simulator  
**Status:** Ready for execution  
**Task size:** Small / Read-only discovery  

---

## Objective

Inspect the **actual project workspace or CI runner** that will execute the repository, and report whether it can support the `RISK-001` feasibility spike.

This task must not inspect or request access to the user's personal computer unless that computer is explicitly selected as the implementation environment.

If you do not have access to the actual repository workspace or runner:

1. Stop immediately.
2. Report that limitation.
3. Do not substitute the assistant sandbox.
4. Do not pretend the sandbox represents the real project environment.

---

## Scope

Check only the following:

1. Repository/workspace identity and current path.
2. Operating system and CPU architecture.
3. Git repository status and current branch.
4. Node.js and npm versions.
5. Docker CLI availability.
6. Docker daemon accessibility.
7. Ability to run one harmless temporary container.
8. `arm-none-eabi-gcc` availability and exact version.
9. Renode availability and exact version.
10. Available real disk space for the workspace.
11. Outbound DNS and HTTPS availability required to pull packages or images.
12. Any permission, network, virtualization, or container restrictions.

---

## Required Commands

Use platform-appropriate equivalents where necessary.

### Linux or macOS

```bash
pwd
git rev-parse --show-toplevel
git status --short --branch

uname -a
uname -m

node --version
npm --version
git --version

docker --version
docker info
docker run --rm hello-world

arm-none-eabi-gcc --version
renode --version

df -h .

getent hosts github.com
getent hosts registry-1.docker.io

curl -I --max-time 10 https://github.com/
curl -I --max-time 10 https://registry-1.docker.io/v2/
