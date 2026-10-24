# Online Readiness: Threat Model and Deployment Design

**Status:** design only. Nothing in this document is deployed, provisioned,
or enabled.

## Hard stop

No public or shared deployment is approved. Until the project owner
explicitly approves each item below, the project does **not**:

- expose the orchestrator or any code-execution API on a network or public IP;
- provision paid infrastructure, spend money, or request new credentials;
- change DNS, enable GitHub Pages, or publish an endpoint;
- remove or weaken the local-only safeguards listed below.

The orchestrator stays a **local, trusted, single-user tool** ([SECURITY.md](../SECURITY.md)).

---

## 1. What runs today (local trusted mode)

| Component | Behaviour | Source |
|---|---|---|
| HTTP server | Binds to `127.0.0.1` only and refuses other `HOST` values. API requests must carry a `Host` (and `Origin`, when sent) of `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding defence) | `apps/orchestrator/src/server.js` (`HOST`, `isSameOrigin`) |
| Request bodies | JSON only, at most 128 KiB | `server.js` (`MAX_BODY_BYTES`) |
| Static files | Served from `apps/web` only; a resolved path outside it gets 403 | `server.js` (`handleStatic`) |
| Compiler | `arm-none-eabi-gcc` started with a fixed argument vector and no shell. Source at most 64 KiB, 30 s timeout, ELF at most 1 MiB. Private temporary directory, removed afterwards | `apps/orchestrator/src/compiler.js` (`LIMITS`, `COMPILER_FLAGS`) |
| Builds | At most 4 kept, oldest evicted | `server.js` (`MAX_BUILDS`) |
| Simulation | **One** active simulation for the whole server: starting a session stops the previous one. Renode limits: 600 s virtual time, 30 min wall time, 120 s start-up | `server.js` (`active`), `renode-session.js` (`SESSION_LIMITS`) |
| Toolchains | Downloaded by `npm run setup:tools` and checked against pinned SHA-256 hashes | `scripts/setup-tools.mjs` |
| Browser | Console lines, problems, and tooltips are set as text; part markup escapes attribute values and LCD characters (`escapeXml`); `diagram.json` is validated before use. An HTML-injection test for compiler output comes with the compile-problems PR (#28, `e2e/diagnostics.spec.js`) | `apps/web/app.js`, `apps/web/workspace/parts.js`, `apps/web/workspace/diagram.js` |

What is **not** there: network isolation, CPU/memory/process limits,
filesystem isolation, authentication, per-user sessions, rate limits, and
security response headers. Each one is acceptable on a student's own machine,
where the only user is the attacker's own victim. None is acceptable once
anyone else can send code.

## 2. Assets and trust boundaries

**Assets**
- the host machine and its files;
- other users' source code and sessions;
- service availability and running cost;
- the project's credentials (CI tokens, any future cloud keys);
- users' browsers.

**Untrusted input**
- C source and inline assembly;
- `diagram.json` files;
- API request bodies and parameters;
- firmware behaviour inside the emulator;
- the event stream the firmware produces.

**Boundaries**
- browser ↔ API;
- API ↔ compiler process;
- API ↔ Renode process;
- process ↔ host (filesystem, network, kernel);
- session ↔ session.

## 3. Threats

Each threat has an ID; the acceptance tests in section 6 cite them.

### T1. Arbitrary file read through the compiler
- **Attack:** `#include "/etc/passwd"` or `#include "/proc/self/environ"`.
  - GCC reads any file the server user can read and quotes it in diagnostics.
  - `__has_include("/path")` probes whether a file exists.
  - `__asm__(".incbin \"/path\"")` embeds a file in the ELF. The firmware can then replay it through GPIO events streamed to the browser.
- **Control today:** none. GCC runs as the server user.
- **Required:**
  - compile in a worker whose filesystem contains only the toolchain, the device headers, and a per-job scratch directory;
  - no secrets in its environment;
  - read-only root filesystem.

### T2. Network access from untrusted code paths
- **Attack:** GCC and Renode do not need a network. A compromised process would use one to exfiltrate data or attack internal services.
- **Control today:** none (the host's network).
- **Required:**
  - a worker with no network interface (network namespace `none`);
  - results return only through the job's own channel.

### T3. Resource exhaustion
- **Attack:**
  - **Memory:** huge static arrays or macro expansion during compilation.
  - **Disk:** large object files are written before the ELF-size check runs.
  - **CPU:** a 30 s compile, or a simulation running up to 30 min.
  - **Many requests at once.**
- **Control today:** compile timeout, source, body, and ELF size limits, the virtual- and wall-time limits, and one simulation at a time.
- **Required:**
  - per-job memory, CPU, process (PID), and disk limits (cgroups plus a size-capped tmpfs);
  - a global cap on concurrent jobs, with a queue and back-pressure;
  - per-user and per-IP rate limits.

### T4. Emulator or toolchain escape
- **Attack:** firmware-controlled values reach Renode (.NET) and the project's C# peripheral models; source reaches GCC. A memory-safety or logic bug in either could hand an attacker the worker process.
- **Control today:** child processes only.
- **Required:**
  - assume the worker can be compromised;
  - one ephemeral sandbox (gVisor or a Firecracker microVM, or at minimum a rootless container with `seccomp`, no capabilities, and `no-new-privileges`) per build and session;
  - the sandbox is destroyed afterwards;
  - images pinned by digest and scanned.

### T5. Cross-user interference
- **Attack:**
  - starting a session stops whoever else is running, because there is one global `active` simulation;
  - build and session IDs are not tied to a user, so anyone holding an ID can start, control, or watch that session.
- **Control today:** random UUIDs; single user by design.
- **Required:**
  - per-user session ownership (a signed session token bound to a build and a user or anonymous visitor);
  - one session per user;
  - no global state shared between sessions.

### T6. Abuse and cost
- **Attack:** unauthenticated compute is a free CPU for anyone, or a way to run up the bill or deny service.
- **Control today:** not applicable (local only).
- **Required:**
  - an access model (anonymous with strict quotas, or class codes, or accounts);
  - budget alarms and a hard spending ceiling;
  - maximum worker count;
  - a kill switch that disables execution while leaving the static site up.

### T7. Browser-side injection
- **Attack:** HTML or script in compiler output, `diagram.json`, part names, or LCD text.
- **Control today:** text rendering and escaped part markup, diagram validation, same-origin API.
- **Required for hosting:**
  - a Content-Security-Policy without inline script;
  - `X-Content-Type-Options: nosniff`;
  - `Referrer-Policy`;
  - `frame-ancestors` (or `X-Frame-Options`);
  - HTTPS only (HSTS).
  - Parts are drawn from SVG strings today, so the CSP needs a review of inline styles before it can be strict.

### T8. Personal data
- **Data involved:** source code and circuits are student work.
- **Control today:**
  - drafts live only in the student's browser (`localStorage`);
  - server temporary files are removed after use;
  - there are no accounts.
- **Required:**
  - a privacy notice;
  - a retention limit for any server-side artifacts and logs;
  - logs that never contain source code by default.

### T9. Supply chain
- **Attack:** a tampered toolchain, Renode, or npm package.
- **Control today:** toolchain archives are SHA-256 pinned; Playwright, Renode, and GCC versions are pinned.
- **Required:**
  - worker images built in CI from pinned inputs;
  - an image digest recorded in the release;
  - a software bill of materials (SBOM) and a vulnerability scan for each image.

### T10. Local server attacked from a web page
- **Attack:** a malicious site the student visits calls `http://127.0.0.1:5123/api/...` (cross-site request forgery, DNS rebinding).
- **Control today:**
  - the Host and Origin allowlist, and a 403 for cross-origin requests (tested in `tests/server.test.js`);
  - JSON-only bodies.
- **Required:** keep this. It must never be relaxed to make a hosted frontend talk to a local backend.

### T11. Information in error messages
- **Attack:** server paths and temporary directory names leak into messages.
- **Control today:**
  - the build directory is removed from the build log, and from compiler diagnostics once PR #28 lands;
  - other errors can name local tool paths.
- **Required:** generic errors for anything that is not compiler output.

## 4. Target architecture for any shared deployment (design, not built)

```text
Browser ──HTTPS──> static frontend (CDN)
   │
   └──HTTPS──> API gateway ── auth / quotas / rate limits / size limits / security headers
                   │
                   ├── job queue (bounded; back-pressure: "busy, try again")
                   │
                   └── worker pool (max N) ── one ephemeral sandbox per build + session
                          • no network interface
                          • read-only image pinned by digest; non-root; no capabilities;
                            seccomp; no-new-privileges; gVisor or Firecracker runtime
                          • tmpfs scratch, size-capped; destroyed after the session
                          • cgroups: CPU, memory, PIDs; wall-time and virtual-time limits
                          • GCC + Renode + models only; no secrets in the environment
                   events ⇐ worker stdout (JSON lines) ⇐ gateway ⇐ SSE to the owner only
```

- **The gateway** is the only component with credentials. Workers get a job and return results; they cannot call out.
- **Sessions** are bound to a signed token, one per user. Stopping or watching a session requires its token.
- **Observability:** job counts, durations, limit kills, and queue depth. Logs carry job metadata only; source code is logged only with the user's consent for a bug report.
- **Kill switch:** execution can be disabled with one flag; the static frontend then explains that running firmware is unavailable.

## 5. Deployment options (none selected; each needs the owner's approval)

| Option | Code execution | Risk | Cost | What it needs |
|---|---|---|---|---|
| A. Static showcase only (e.g. GitHub Pages with screenshots and a recorded demo) | None | Low | None | Approval to enable Pages; content changes so it never claims to run code |
| B. Classroom server: one VM, Docker with gVisor, invited users with class codes | Yes, small group | Moderate | One small VM | Sections 4 and 6 complete; a budget; an owner who operates it |
| C. Public service on a managed sandbox platform (e.g. a container platform with gVisor, or Firecracker microVMs) | Yes, anyone | High | Variable; needs hard caps | Everything in B, plus the access model, abuse handling, a privacy notice, and incident response |

Recommendation for when the owner decides: start with **A**. Move to **B**
only after the acceptance tests in section 6 pass against a candidate worker
image in CI. **C** is out of scope until B has run safely.

## 6. Isolation acceptance tests (run against a candidate worker image, in CI, before any exposure)

| # | Probe | Expected |
|---|---|---|
| 1 | `#include "/etc/passwd"`, `#include "/proc/self/environ"` | "No such file", or a file with no host data (the image holds no host files) |
| 2 | `__asm__(".incbin \"/proc/self/environ\"")` | Build fails, or the embedded bytes contain no secret (the environment is empty) |
| 3 | `__has_include` sweep of common host paths | Only toolchain and device headers exist |
| 4 | Network from inside the worker (harness command, not user code) | No interface, so connect and DNS both fail |
| 5 | `static char big[512u << 20];` and a macro-expansion bomb | Rejected at link or by the memory limit; the worker is killed cleanly; the next job is unaffected |
| 6 | Large object-file output | Disk quota hit inside tmpfs; host unaffected |
| 7 | Compile that runs over 30 s; firmware that runs forever | Killed at the time limits; resources released |
| 8 | Two users: B tries to stop, control, and watch A's session with A's IDs but B's token | 403 every time |
| 9 | 50 concurrent builds | Queue bounded; extra requests get "busy"; no worker beyond the cap |
| 10 | Worker escape smoke test: firmware writes outside peripheral memory; malformed ELF sections | Bus faults or rejected builds; sandbox intact |
| 11 | Response headers on every route | CSP, nosniff, Referrer-Policy, frame-ancestors, and HSTS present |

## 7. Readiness today

| Area | Status | Why |
|---|---|---|
| Local trusted mode | PASS | Controls in section 1, covered by `tests/server.test.js` and the browser tests |
| Online execution isolation | BLOCKED | No worker sandbox (T1–T4); no acceptance tests yet |
| Multi-user sessions | BLOCKED | One global simulation; no ownership (T5) |
| Abuse and cost controls | BLOCKED | No access model, quotas, or budget (T6) |
| Browser hardening for hosting | NEEDS WORK | Text-only rendering is in place; security headers and CSP review are not (T7) |
| Privacy and retention | NEEDS WORK | No notice or policy for a hosted service (T8) |
| Supply chain | NEEDS WORK | Pinned toolchains; no worker image, SBOM, or scan yet (T9) |
| Public hosting | BLOCKED | Requires all of the above and the owner's explicit approval |

## 8. Decisions the owner must make (none is made here)

1. Whether to publish a static showcase (option A), and where.
2. Whether a hosted execution service is wanted at all; if so, for whom (a class or the public).
3. Budget ceiling, and who receives the cost alarms.
4. Access model: anonymous with quotas, class codes, or accounts.
5. Retention of submitted code and logs.
6. The license for the repository (still open; `package.json` says `UNLICENSED`).
