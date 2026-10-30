/*
 * Quick Start smoke check (evidence only, not for merge): against a server
 * started with `npm start`, load the page, compile example A through the API,
 * start a session, and wait until the firmware runs and drives PF1 HIGH.
 *   node smoke.mjs [base-url]
 */
const base = process.argv[2] ?? "http://127.0.0.1:5123";

async function json(path, body) {
  const response = await fetch(`${base}${path}`, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

const page = await fetch(`${base}/`);
const html = await page.text();
console.log(`GET / -> ${page.status}, ${html.length} bytes, title ok: ${html.includes("<title>TM4C123 Simulator")}`);
if (page.status !== 200 || !html.includes("TM4C123 Simulator")) {
  throw new Error("page did not load");
}
const health = await json("/api/health");
console.log(`GET /api/health -> ${health.status} ${JSON.stringify(health.data)}`);

const { data: examples } = await json("/api/examples");
const list = examples.examples ?? examples;
const a = list.find((e) => e.id === "gpiof-red-led");
console.log(`examples: ${list.length}, example A: ${a?.title}`);

const build = await json("/api/build", { source: a.source });
console.log(`POST /api/build -> ${build.status} ok=${build.data.ok} in ${build.data.durationMs} ms`);
if (!build.data.ok) {
  throw new Error(build.data.error);
}
const session = await json("/api/sessions", { buildId: build.data.buildId, autoRun: true });
console.log(`POST /api/sessions -> ${session.status}`);

// Read the session's event stream until the firmware is running and PF1 is reported HIGH.
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 90_000);
const stream = await fetch(`${base}/api/sessions/${session.data.sessionId}/events`, { signal: controller.signal });
const decoder = new TextDecoder();
let buffer = "";
let running = false;
let pf1High = null;
let lastNs = "0";
for await (const chunk of stream.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let end;
  while ((end = buffer.indexOf("\n\n")) >= 0) {
    const frame = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
    if (!data) {
      continue;
    }
    const message = JSON.parse(data);
    if (message.type === "session-status") {
      running ||= message.state === "running";
      lastNs = message.virtualTimeNs ?? lastNs;
    }
    const event = message.event;
    if (message.type === "simulator-event" && event?.type === "digital-pin-changed" && event.pin?.pinId === "PF1" && event.level === 1) {
      pf1High ??= event;
    }
  }
  if (running && pf1High && BigInt(lastNs) > 0n) {
    break;
  }
}
clearTimeout(timer);
controller.abort();
console.log(`running: ${running}, virtual time ${Number(BigInt(lastNs)) / 1e6} ms, PF1 HIGH event: ${JSON.stringify(pf1High)}`);
if (!running || !pf1High) {
  throw new Error("firmware did not run and drive PF1 HIGH");
}
console.log("SMOKE OK (session left running so shutdown can be checked)");
process.exit(0);
