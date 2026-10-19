/*
 * Shared lookup of the pinned, project-local toolchains in .tools/.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const toolsDir = path.join(repoRoot, ".tools");
export const lock = JSON.parse(readFileSync(path.join(repoRoot, "tools.lock.json"), "utf8"));

export const platformKey = `${process.platform}-${process.arch}`;

const exe = process.platform === "win32" ? ".exe" : "";

function installDir(name) {
  return path.join(toolsDir, `${name}-${lock[name].version}`);
}

/** Absolute path of an arm-none-eabi-* binary, or the bare name to use PATH. */
export function armTool(tool) {
  const override = process.env.TM4C_ARM_GCC_BIN;
  if (override) {
    return path.join(override, `arm-none-eabi-${tool}${exe}`);
  }
  const spec = lock["arm-none-eabi-gcc"].platforms[platformKey];
  if (spec) {
    const candidate = path.join(installDir("arm-none-eabi-gcc"), spec.bin, `arm-none-eabi-${tool}${exe}`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return `arm-none-eabi-${tool}${exe}`;
}

/** Absolute path of the Renode launcher, or "renode" to use PATH. */
export function renodeBinary() {
  if (process.env.TM4C_RENODE) {
    return process.env.TM4C_RENODE;
  }
  const root = installDir("renode");
  if (existsSync(root)) {
    // The portable archives unpack into a single versioned folder whose
    // exact name differs between platforms, so search one level down.
    const names = process.platform === "win32" ? ["renode.exe", "Renode.exe"] : ["renode"];
    for (const child of ["", ...readdirSync(root)]) {
      for (const name of names) {
        const candidate = path.join(root, child, name);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return "renode";
}
