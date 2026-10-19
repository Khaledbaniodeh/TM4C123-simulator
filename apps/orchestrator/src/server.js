/*
 * TM4C123 Simulator — local orchestrator server.
 *
 * Serves the web workspace and a small JSON API that compiles firmware with
 * arm-none-eabi-gcc and executes it in Renode. Runtime events reach the
 * browser over Server-Sent Events; the browser renders them and never
 * computes hardware state itself.
 *
 * SECURITY: this is a trusted, single-user, local development server. It
 * binds to the loopback interface only and refuses any other bind address.
 * Compilation and execution run as ordinary child processes with time and
 * size limits but WITHOUT container isolation. Do not expose it to a
 * network. See SECURITY.md.
 *
 *   node apps/orchestrator/src/server.js [--port 5123]
 */
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compileFirmware, removeBuild, run } from "./compiler.js";
import { RenodeSession } from "./renode-session.js";
import { armTool, lock, renodeBinary, repoRoot } from "../../../scripts/lib/tools.mjs";
import { BOARD_INPUTS } from "../../web/board-state.js";

const HOST = "127.0.0.1";
const WEB_DIR = path.join(repoRoot, "apps", "web");
const EXAMPLES_DIR = path.join(repoRoot, "examples");

/**
 * Virtual time advanced per scheduling step. Each step costs a few Monitor
 * round trips (~18 ms each measured on Windows), so larger steps run closer
 * to real time; 50 ms keeps switch input latency acceptable.
 */
const STEP_NS = 50_000_000n;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_BUILDS = 4;

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  // Browsers only accept JSON modules (`import … with { type: "json" }`) with a JSON MIME type.
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Successful builds kept on disk until evicted (oldest first). */
const builds = new Map();
/** The single active simulation (local, single-user). */
let active = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendJson(response, status, body) {
  const text = JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(text);
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw Object.assign(new Error("Request body too large"), { status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

/** Rejects cross-origin and DNS-rebinding requests to the local API. */
function isSameOrigin(request, port) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!allowedHosts.has(request.headers.host ?? "")) {
    return false;
  }
  const origin = request.headers.origin;
  return origin === undefined || allowedHosts.has(origin.replace(/^https?:\/\//, ""));
}

async function loadExamples() {
  const entries = await readdir(EXAMPLES_DIR, { withFileTypes: true });
  const examples = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const meta = JSON.parse(await readFile(path.join(EXAMPLES_DIR, entry.name, "example.json"), "utf8"));
      const source = await readFile(path.join(EXAMPLES_DIR, entry.name, "main.c"), "utf8");
      // Optional circuit for the workspace; parsed and validated in the browser.
      const diagram = await readFile(path.join(EXAMPLES_DIR, entry.name, "diagram.json"), "utf8").catch(() => null);
      examples.push({ ...meta, source, diagram });
    } catch {
      // Directories without a manifest are not offered in the UI.
    }
  }
  return examples.sort((a, b) => a.title.localeCompare(b.title));
}

async function toolchainInfo() {
  const gcc = await run(armTool("gcc"), ["--version"], { timeoutMs: 15_000 }).catch((error) => ({ code: -1, stdout: "", stderr: String(error) }));
  return {
    gcc: gcc.code === 0 ? gcc.stdout.split(/\r?\n/)[0] : null,
    gccPinned: lock["arm-none-eabi-gcc"].version,
    renodePinned: lock.renode.version,
    renodePath: renodeBinary(),
  };
}

/** Deletes the oldest builds beyond MAX_BUILDS, never the one being executed. */
async function evictBuilds() {
  for (const [id, build] of builds) {
    if (builds.size <= MAX_BUILDS) {
      break;
    }
    if (active?.buildId !== id) {
      builds.delete(id);
      await removeBuild(build.workDir);
    }
  }
}

// ---------------------------------------------------------------------------
// Simulation sessions
// ---------------------------------------------------------------------------

class ActiveSimulation {
  constructor(buildId) {
    this.id = randomUUID();
    this.buildId = buildId;
    this.session = null;
    this.state = "starting";
    this.clients = new Set();
    this.history = [];
    this.loop = null;
    this.error = null;
  }

  broadcast(message) {
    this.history.push(message);
    if (this.history.length > 5_000) {
      this.history.splice(0, this.history.length - 5_000);
    }
    const payload = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of this.clients) {
      client.write(payload);
    }
  }

  status(extra = {}) {
    this.broadcast({
      type: "session-status",
      state: this.state,
      virtualTimeNs: (this.session?.virtualTimeNs ?? 0n).toString(),
      ...extra,
    });
  }

  async start(elfPath) {
    this.status();
    try {
      this.session = await RenodeSession.start(elfPath);
    } catch (error) {
      this.state = "error";
      this.error = error.message;
      this.status({ message: `Execution engine failed to start: ${error.message}` });
      return;
    }
    this.session.on("event", (event) => this.broadcast({ type: "simulator-event", event }));
    this.session.on("engine-log", (entry) => this.broadcast({ type: "engine-log", ...entry }));
    this.session.on("limit", (limit) => this.broadcast({ type: "session-limit", ...limit }));
    this.session.on("exit", () => {
      if (this.state !== "stopped") {
        this.state = "error";
        this.status({ message: "Renode exited unexpectedly." });
      }
    });
    // Replay power-on events collected while the platform loaded.
    for (const event of this.session.events) {
      this.broadcast({ type: "simulator-event", event });
    }
    this.state = "paused";
    this.status({ message: "Firmware loaded. CPU halted at reset." });
  }

  /** Advances virtual time in steps, paced to wall-clock time for display. */
  run() {
    if (this.state !== "paused" || !this.session) {
      return;
    }
    this.state = "running";
    this.status();
    const loop = async () => {
      const wallStart = performance.now();
      const virtualStart = this.session.virtualTimeNs;
      while (this.state === "running") {
        try {
          await this.session.runFor(STEP_NS);
        } catch (error) {
          if (this.state === "running") {
            this.state = "error";
            this.status({ message: error.message });
          }
          return;
        }
        // Real-time pacing: never let virtual time get ahead of wall time.
        const virtualElapsedMs = Number(this.session.virtualTimeNs - virtualStart) / 1e6;
        const wallElapsedMs = performance.now() - wallStart;
        this.status({ realTimeFactor: Math.min(1, virtualElapsedMs / wallElapsedMs) });
        if (virtualElapsedMs > wallElapsedMs) {
          await new Promise((resolve) => setTimeout(resolve, virtualElapsedMs - wallElapsedMs));
        }
      }
    };
    this.loop = loop();
  }

  async pause() {
    if (this.state === "running") {
      this.state = "paused";
      await this.loop;
      this.status();
    }
  }

  async reset() {
    const wasRunning = this.state === "running";
    await this.pause();
    if (this.state !== "paused") {
      return;
    }
    await this.session.reset();
    this.broadcast({ type: "mcu-reset", virtualTimeNs: this.session.virtualTimeNs.toString() });
    if (wasRunning) {
      this.run();
    } else {
      this.status({ message: "MCU reset. CPU halted at reset." });
    }
  }

  async input(name, pressed) {
    const mapping = BOARD_INPUTS[name];
    if (!mapping) {
      throw Object.assign(new Error(`Unknown board input: ${name}`), { status: 400 });
    }
    if (!this.session || this.state === "stopped" || this.state === "error") {
      throw Object.assign(new Error("No running simulation"), { status: 409 });
    }
    // LaunchPad switches short the pin to ground when pressed and leave it
    // open when released (the firmware must enable the internal pull-up).
    await this.session.setExternalInput(mapping.port, mapping.pin, pressed ? false : null);
    this.broadcast({ type: "board-input", input: name, pressed, virtualTimeNs: this.session.virtualTimeNs.toString() });
  }

  /**
   * Drives a GPIO pin from the external circuit (wired parts in the
   * workspace): "low" / "high" drive the pin, "release" leaves it undriven.
   */
  async drivePin(pinId, level) {
    const match = /^P([A-F])([0-7])$/.exec(String(pinId));
    if (!match || !["low", "high", "release"].includes(level)) {
      throw Object.assign(new Error(`Invalid external drive: ${pinId}=${level}`), { status: 400 });
    }
    if (!this.session || this.state === "stopped" || this.state === "error") {
      throw Object.assign(new Error("No running simulation"), { status: 409 });
    }
    await this.session.setExternalInput(match[1], Number(match[2]), level === "release" ? null : level === "high");
    this.broadcast({ type: "external-drive", pin: pinId, level, virtualTimeNs: this.session.virtualTimeNs.toString() });
  }

  async stop() {
    const previous = this.state;
    this.state = "stopped";
    await this.loop;
    await this.session?.close();
    if (previous !== "stopped") {
      this.status({ message: "Simulation stopped." });
    }
    for (const client of this.clients) {
      client.end();
    }
    this.clients.clear();
  }
}

// ---------------------------------------------------------------------------
// HTTP routing
// ---------------------------------------------------------------------------

async function handleApi(request, response, url) {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]

  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, {
      ok: true,
      mode: "local-trusted",
      isolation: "Child processes with time/size limits. No container sandbox: local development only.",
      toolchain: await toolchainInfo(),
    });
  }

  if (request.method === "GET" && url.pathname === "/api/examples") {
    return sendJson(response, 200, { examples: await loadExamples() });
  }

  if (request.method === "POST" && url.pathname === "/api/build") {
    const body = await readJson(request);
    if (typeof body.source !== "string") {
      return sendJson(response, 400, { error: "Expected { source: string }" });
    }
    const started = performance.now();
    const result = await compileFirmware(body.source);
    const durationMs = Math.round(performance.now() - started);
    if (!result.ok) {
      await removeBuild(result.workDir);
      return sendJson(response, 200, {
        ok: false, error: result.error, diagnostics: result.diagnostics, log: result.log, durationMs,
      });
    }
    const buildId = randomUUID();
    builds.set(buildId, result);
    await evictBuilds();
    return sendJson(response, 200, {
      ok: true, buildId, diagnostics: result.diagnostics, log: result.log, elf: result.elf, durationMs,
    });
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const body = await readJson(request);
    const build = builds.get(body.buildId);
    if (!build) {
      return sendJson(response, 404, { error: "Unknown or expired build. Compile again." });
    }
    if (active) {
      await active.stop();
    }
    active = new ActiveSimulation(body.buildId);
    const simulation = active;
    simulation.start(build.elfPath).then(() => {
      if (body.autoRun && simulation.state === "paused") {
        simulation.run();
      }
    });
    return sendJson(response, 201, { sessionId: simulation.id });
  }

  if (parts[1] === "sessions" && parts[2]) {
    const simulation = active?.id === parts[2] ? active : null;
    if (!simulation) {
      return sendJson(response, 404, { error: "Unknown session" });
    }

    if (request.method === "GET" && parts[3] === "events") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
      });
      for (const message of simulation.history) {
        response.write(`data: ${JSON.stringify(message)}\n\n`);
      }
      simulation.clients.add(response);
      request.on("close", () => simulation.clients.delete(response));
      return;
    }

    if (request.method === "POST" && parts[3] === "control") {
      const { action } = await readJson(request);
      switch (action) {
      case "run": simulation.run(); break;
      case "pause": await simulation.pause(); break;
      case "reset": await simulation.reset(); break;
      case "stop":
        await simulation.stop();
        if (active === simulation) {
          active = null;
        }
        break;
      default:
        return sendJson(response, 400, { error: `Unknown action: ${action}` });
      }
      return sendJson(response, 200, { state: simulation.state });
    }

    if (request.method === "POST" && parts[3] === "input") {
      const body = await readJson(request);
      if (body.pin !== undefined) {
        await simulation.drivePin(String(body.pin), String(body.level));
      } else {
        await simulation.input(String(body.input), Boolean(body.pressed));
      }
      return sendJson(response, 200, { ok: true });
    }
  }

  return sendJson(response, 404, { error: "Not found" });
}

async function handleStatic(request, response, url) {
  const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.resolve(WEB_DIR, relative);
  if (!file.startsWith(WEB_DIR + path.sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": STATIC_TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
}

export function createServer({ port }) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${HOST}:${port}`);
    try {
      if (url.pathname.startsWith("/api/")) {
        if (!isSameOrigin(request, port)) {
          return sendJson(response, 403, { error: "Cross-origin requests are not allowed" });
        }
        return await handleApi(request, response, url);
      }
      return await handleStatic(request, response, url);
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, error.status ?? 500, { error: error.message });
      } else {
        response.end();
      }
    }
  });
}

/**
 * Removes build/session directories left behind by servers that did not
 * shut down cleanly (e.g. killed processes). Only directories older than
 * `maxAgeMs` are touched, so concurrently running instances are unaffected.
 */
export async function sweepStaleTempDirs(maxAgeMs = 6 * 60 * 60 * 1000) {
  const root = os.tmpdir();
  let removed = 0;
  for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || !/^tm4c-(build|session)-/.test(entry.name)) {
      continue;
    }
    const dir = path.join(root, entry.name);
    const info = await stat(dir).catch(() => null);
    if (info && Date.now() - info.mtimeMs > maxAgeMs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      removed++;
    }
  }
  return removed;
}

export async function shutdown() {
  await active?.stop();
  active = null;
  for (const build of builds.values()) {
    await removeBuild(build.workDir);
  }
  builds.clear();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const portIndex = process.argv.indexOf("--port");
  const port = Number(portIndex > 0 ? process.argv[portIndex + 1] : process.env.PORT ?? 5123);
  if (process.env.HOST && process.env.HOST !== HOST) {
    console.error(`Refusing to bind to ${process.env.HOST}: this server is for local, trusted use only (${HOST}).`);
    process.exit(1);
  }
  const swept = await sweepStaleTempDirs();
  if (swept) {
    console.log(`Removed ${swept} stale build/session director${swept === 1 ? "y" : "ies"} from earlier runs.`);
  }
  const server = createServer({ port });
  server.listen(port, HOST, () => {
    console.log(`TM4C123 Simulator running at http://${HOST}:${port}/ (local trusted mode)`);
  });
  const exit = async () => {
    server.close();
    await shutdown();
    process.exit(0);
  };
  process.on("SIGINT", exit);
  process.on("SIGTERM", exit);
}
