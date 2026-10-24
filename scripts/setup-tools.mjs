#!/usr/bin/env node
/*
 * Installs the pinned, project-local toolchains listed in tools.lock.json
 * into .tools/. Nothing is installed system-wide and no elevation is needed.
 *
 *   node scripts/setup-tools.mjs            # install everything missing
 *   node scripts/setup-tools.mjs --check    # report status only
 *
 * Every archive is verified against its pinned SHA-256 before extraction.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { platformKey, toolsDir, lock } from "./lib/tools.mjs";

const checkOnly = process.argv.includes("--check");

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }
  const partial = `${dest}.partial`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  await rename(partial, dest);
}

function extract(archive, destination) {
  // bsdtar (Windows 10+ System32\tar.exe) and GNU tar (Linux) both handle
  // .tar.gz; only bsdtar handles .zip, so use it explicitly on Windows.
  const tar = process.platform === "win32"
    ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "tar";
  const result = spawnSync(tar, ["-xf", archive, "-C", destination], { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Extraction failed for ${archive}`);
  }
}

async function install(name) {
  const entry = lock[name];
  const spec = entry.platforms[platformKey];
  if (!spec) {
    throw new Error(`${name} has no pinned build for ${platformKey}`);
  }

  const installDir = path.join(toolsDir, `${name}-${entry.version}`);
  const marker = path.join(installDir, ".installed");
  if (existsSync(marker)) {
    console.log(`[ok]      ${name} ${entry.version} (${installDir})`);
    return;
  }
  if (checkOnly) {
    console.log(`[missing] ${name} ${entry.version}`);
    process.exitCode = 1;
    return;
  }

  const downloads = path.join(toolsDir, "downloads");
  await mkdir(downloads, { recursive: true });
  const archive = path.join(downloads, path.basename(new URL(spec.url).pathname));

  if (!existsSync(archive)) {
    console.log(`[fetch]   ${spec.url}`);
    await download(spec.url, archive);
  }

  const actual = await sha256(archive);
  if (actual !== spec.sha256) {
    await rm(archive, { force: true });
    throw new Error(`SHA-256 mismatch for ${archive}\n  expected ${spec.sha256}\n  actual   ${actual}`);
  }
  console.log(`[verify]  sha256 ${actual}`);

  await rm(installDir, { recursive: true, force: true });
  await mkdir(installDir, { recursive: true });
  console.log(`[extract] ${installDir}`);
  extract(archive, installDir);
  await writeFile(marker, `${entry.version}\n${spec.sha256}\n`);
  await rm(archive, { force: true });
  console.log(`[ok]      ${name} ${entry.version}`);
}

await mkdir(toolsDir, { recursive: true });
for (const name of Object.keys(lock).filter((key) => !key.startsWith("$"))) {
  await install(name);
}
