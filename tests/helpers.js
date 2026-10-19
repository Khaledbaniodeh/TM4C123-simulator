/*
 * Shared helpers for the integration tests. Every helper goes through the
 * same compiler runner and Renode session code the web server uses.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { compileFirmware, removeBuild } from "../apps/orchestrator/src/compiler.js";
import { RenodeSession } from "../apps/orchestrator/src/renode-session.js";
import { repoRoot } from "../scripts/lib/tools.mjs";

export const MS = 1_000_000n;

export async function exampleSource(id) {
  return readFile(path.join(repoRoot, "examples", id, "main.c"), "utf8");
}

export async function fixtureSource(name) {
  return readFile(path.join(repoRoot, "tests", "fixtures", "firmware", name), "utf8");
}

/** Compiles source, asserting success, and returns the build result. */
export async function build(source) {
  const result = await compileFirmware(source);
  if (!result.ok) {
    await removeBuild(result.workDir);
    throw new Error(`Build failed: ${result.error}\n${result.log}`);
  }
  return result;
}

/**
 * Compiles source, starts a session, and runs `fn(session, build)`.
 * The session and build directory are always cleaned up.
 */
export async function withFirmware(source, fn) {
  const firmware = await build(source);
  let session;
  try {
    session = await RenodeSession.start(firmware.elfPath);
    return await fn(session, firmware);
  } finally {
    await session?.close();
    await removeBuild(firmware.workDir);
  }
}

/** PF-pin change events for one pin, in order. */
export function pinChanges(events, pinId) {
  return events.filter((event) => event.type === "digital-pin-changed" && event.pin?.pinId === pinId);
}

export function lastLevel(events, pinId) {
  const changes = pinChanges(events, pinId);
  return changes.length ? changes.at(-1).level : null;
}
