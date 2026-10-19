/*
 * Orchestrator API tests: HTTP build endpoint, session lifecycle, and the
 * Server-Sent Events stream carrying real simulator events.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createServer, shutdown } from "../apps/orchestrator/src/server.js";
import { exampleSource, fixtureSource } from "./helpers.js";

let server;
let base;

async function post(path, body, headers = {}) {
  const response = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Collects SSE messages until `predicate` matches or the timeout expires. */
async function waitForMessage(sessionId, predicate, timeoutMs = 60_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const messages = [];
  try {
    const response = await fetch(`${base}/api/sessions/${sessionId}/events`, { signal: controller.signal });
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (frame.startsWith("data: ")) {
          const message = JSON.parse(frame.slice(6));
          messages.push(message);
          if (predicate(message, messages)) {
            return { message, messages };
          }
        }
      }
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      throw error;
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
  throw new Error(`Timed out waiting for message; received ${messages.length} messages`);
}

const pf1 = (level) => (m) =>
  m.type === "simulator-event" && m.event.type === "digital-pin-changed" && m.event.pin.pinId === "PF1" && m.event.level === level;

/** Matches `predicate` only for messages that arrive after the first `marker` message. */
const following = (marker, predicate) => (m, messages) => {
  const markerIndex = messages.findIndex(marker);
  return markerIndex >= 0 && messages.length - 1 > markerIndex && predicate(m);
};

describe("orchestrator API", { timeout: 300_000 }, () => {
  before(async () => {
    server = createServer({ port: 0 });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    server.close();
    // Recreate with the real port so same-origin checks match the Host header.
    server = createServer({ port });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await shutdown();
    await new Promise((resolve) => server.close(resolve));
  });

  it("serves the workspace and the example catalog", async () => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>TM4C123 Simulator<\/title>/);
    const { examples } = await (await fetch(`${base}/api/examples`)).json();
    const ids = examples.map((example) => example.id);
    for (const id of ["gpiof-red-led", "gpiof-led-off", "gpiof-blink", "sw1-red-led", "switch-interrupts"]) {
      assert.ok(ids.includes(id), `missing example ${id}`);
    }
    assert.ok(examples.every((example) => example.source.includes("int main(void)")));
  });

  it("rejects cross-origin API requests", async () => {
    const response = await post("/api/build", { source: "int main(void){for(;;){}}" }, { origin: "http://evil.example" });
    assert.equal(response.status, 403);
  });

  it("returns real compiler diagnostics for invalid source", async () => {
    const { status, body } = await post("/api/build", { source: await fixtureSource("compile-error.c") });
    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.buildId, undefined);
    assert.ok(body.diagnostics.some((d) => d.severity === "error" && d.file === "main.c"));
  });

  it("builds, runs, streams PF1 HIGH, resets, and stops", async () => {
    const build = await post("/api/build", { source: await exampleSource("gpiof-red-led") });
    assert.equal(build.body.ok, true);
    assert.equal(build.body.elf.machine, "ARM");

    const started = await post("/api/sessions", { buildId: build.body.buildId, autoRun: true });
    assert.equal(started.status, 201);
    const { sessionId } = started.body;

    const high = await waitForMessage(sessionId, pf1(1));
    assert.equal(high.message.event.drive, "output");
    assert.ok(high.messages.some((m) => m.type === "simulator-event" && m.event.type === "clock-gate-changed"));

    const reset = await post(`/api/sessions/${sessionId}/control`, { action: "reset" });
    assert.equal(reset.status, 200);
    // The stream replays history on connect, so match events after the reset.
    const isResetSnapshot = (m) =>
      m.type === "simulator-event" && m.event.type === "port-snapshot" && m.event.peripheral === "GPIOF" && m.event.cause === "reset";
    const rerun = await waitForMessage(sessionId, following(isResetSnapshot, pf1(1)));
    assert.ok(rerun.message, "firmware drives PF1 HIGH again after reset");
    const snapshot = rerun.messages.find(isResetSnapshot);
    assert.equal(snapshot.event.pins.find((p) => p.pinId === "PF1").state, "floating", "reset returns PF1 to floating");

    const stopped = await post(`/api/sessions/${sessionId}/control`, { action: "stop" });
    assert.equal(stopped.body.state, "stopped");
  });

  it("example B streams PF1 LOW and never HIGH", async () => {
    const build = await post("/api/build", { source: await exampleSource("gpiof-led-off") });
    const { body } = await post("/api/sessions", { buildId: build.body.buildId, autoRun: true });
    const low = await waitForMessage(body.sessionId, pf1(0));
    assert.equal(low.message.event.drive, "output");
    // Let it run a little longer, then confirm no HIGH appeared.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const all = await waitForMessage(body.sessionId, (m) => m.type === "session-status" && m.state === "running" && BigInt(m.virtualTimeNs) > 100_000_000n);
    assert.equal(all.messages.filter(pf1(1)).length, 0);
    await post(`/api/sessions/${body.sessionId}/control`, { action: "stop" });
  });

  it("forwards SW1 presses to the GPIO model", async () => {
    const build = await post("/api/build", { source: await exampleSource("sw1-red-led") });
    const { body } = await post("/api/sessions", { buildId: build.body.buildId, autoRun: true });
    await waitForMessage(body.sessionId, pf1(0));
    const pressed = await post(`/api/sessions/${body.sessionId}/input`, { input: "SW1", pressed: true });
    assert.equal(pressed.status, 200);
    await waitForMessage(body.sessionId, pf1(1));
    await post(`/api/sessions/${body.sessionId}/input`, { input: "SW1", pressed: false });
    await waitForMessage(body.sessionId, following((m) => m.type === "board-input" && !m.pressed, pf1(0)));
    const unknown = await post(`/api/sessions/${body.sessionId}/input`, { input: "SW9", pressed: true });
    assert.equal(unknown.status, 400);
    await post(`/api/sessions/${body.sessionId}/control`, { action: "stop" });
  });

  it("drives external circuit inputs on any GPIO pin (example F: PA6 button -> PA7 LED)", async () => {
    const pa7 = (level) => (m) =>
      m.type === "simulator-event" && m.event.type === "digital-pin-changed" && m.event.pin.pinId === "PA7" && m.event.level === level;
    const build = await post("/api/build", { source: await exampleSource("external-led-button") });
    assert.equal(build.body.ok, true, build.body.log);
    const { body } = await post("/api/sessions", { buildId: build.body.buildId, autoRun: true });
    await waitForMessage(body.sessionId, pa7(0));

    const press = await post(`/api/sessions/${body.sessionId}/input`, { pin: "PA6", level: "low" });
    assert.equal(press.status, 200);
    await waitForMessage(body.sessionId, following((m) => m.type === "external-drive" && m.level === "low", pa7(1)));

    await post(`/api/sessions/${body.sessionId}/input`, { pin: "PA6", level: "release" });
    await waitForMessage(body.sessionId, following((m) => m.type === "external-drive" && m.level === "release", pa7(0)));

    const invalid = await post(`/api/sessions/${body.sessionId}/input`, { pin: "PG9", level: "low" });
    assert.equal(invalid.status, 400);
    await post(`/api/sessions/${body.sessionId}/control`, { action: "stop" });
  });
});
