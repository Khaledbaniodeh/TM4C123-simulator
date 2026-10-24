/*
 * CI screenshot publishing (scripts/ci/publish-screenshots.sh) against a
 * temporary bare repository standing in for the ci-artifacts branch: a new
 * branch, other runs' directories and history kept, unchanged screenshots,
 * two runs pushing at the same instant (the rejected push is retried on the
 * new tip and both publications survive), a transient rejection, every
 * attempt failing, nothing to publish, invalid names, and a remote that is
 * never printed. Needs bash and git, as on the CI runner.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/ci/publish-screenshots.sh", import.meta.url)).replaceAll("\\", "/");
const slash = (p) => p.replaceAll("\\", "/");
const fileUrl = (p) => `file://${slash(p).startsWith("/") ? "" : "/"}${slash(p)}`;

let root;
before(() => {
  root = mkdtempSync(path.join(tmpdir(), "publish-test-"));
});
after(() => {
  rmSync(root, { recursive: true, force: true });
});

let counter = 0;
/** A bare repository with no branches; `name` lets a test put a marker in its path. */
function bareRemote(name = `remote-${++counter}`) {
  const dir = path.join(root, name, "repo.git");
  mkdirSync(dir, { recursive: true });
  assert.equal(spawnSync("git", ["init", "--bare", "-q", dir]).status, 0);
  // Like GitHub with branch protection off for ci-artifacts: fast-forward pushes only.
  spawnSync("git", ["--git-dir", dir, "config", "receive.denyNonFastForwards", "true"]);
  return { dir, url: fileUrl(dir) };
}

/** A results directory with PNGs in nested folders, as the Playwright artifact has them. */
function results(names, content = "png") {
  const dir = path.join(root, `results-${++counter}`);
  for (const name of names) {
    const file = path.join(dir, "test-results", name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${content}:${name}`);
  }
  return slash(dir);
}

function publish(remote, resultsDir, dest, env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [SCRIPT, resultsDir, dest, `Screenshots from ${dest} (test result: success)`], {
      env: { ...process.env, GITHUB_REPOSITORY: "", GITHUB_SHA: "", PUBLISH_REMOTE: remote.url, PUBLISH_BACKOFF: "0", ...env },
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => resolve({ code, output }));
  });
}

const git = (remote, ...args) => spawnSync("git", ["--git-dir", remote.dir, ...args], { encoding: "utf8" });
const tip = (remote) => git(remote, "rev-parse", "--verify", "-q", "refs/heads/ci-artifacts").stdout.trim();
const files = (remote) => git(remote, "ls-tree", "-r", "--name-only", "ci-artifacts").stdout.trim().split("\n").filter(Boolean).sort();
const show = (remote, file) => git(remote, "show", `ci-artifacts:${file}`).stdout;
const isAncestor = (remote, older, newer) => git(remote, "merge-base", "--is-ancestor", older, newer).status === 0;

/** Rejects the next `count` pushes, like a remote that is briefly unavailable. */
function rejectPushes(remote, count) {
  const hook = path.join(remote.dir, "hooks", "pre-receive");
  writeFileSync(hook, [
    "#!/bin/sh",
    "count_file=\"$GIT_DIR/reject-count\"",
    "n=$(cat \"$count_file\" 2>/dev/null || echo 0)",
    "if [ \"$n\" -gt 0 ]; then echo $((n - 1)) > \"$count_file\"; echo 'temporarily unavailable' >&2; exit 1; fi",
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(hook, 0o755);
  writeFileSync(path.join(remote.dir, "reject-count"), String(count));
}

describe("CI screenshot publishing", () => {
  it("creates the branch, then keeps other runs' directories and history; unchanged screenshots publish nothing", async () => {
    const remote = bareRemote();
    const first = await publish(remote, results(["a/one.png", "b/two.png"]), "feat/a");
    assert.equal(first.code, 0, first.output);
    assert.match(first.output, /does not exist yet/);
    assert.deepEqual(files(remote), ["feat/a/README.md", "feat/a/one.png", "feat/a/two.png"]);
    assert.equal(show(remote, "feat/a/README.md"), "Screenshots from feat/a (test result: success)\n");
    const afterA = tip(remote);

    const second = await publish(remote, results(["x.png"]), "release/b");
    assert.equal(second.code, 0, second.output);
    assert.deepEqual(files(remote), ["feat/a/README.md", "feat/a/one.png", "feat/a/two.png", "release/b/README.md", "release/b/x.png"]);
    assert.ok(isAncestor(remote, afterA, tip(remote)), "history kept: the earlier tip is an ancestor");

    // A run's directory is replaced as a whole: old screenshots of that branch go, others stay.
    const third = await publish(remote, results(["one.png"], "new"), "feat/a");
    assert.equal(third.code, 0, third.output);
    assert.deepEqual(files(remote), ["feat/a/README.md", "feat/a/one.png", "release/b/README.md", "release/b/x.png"]);
    assert.equal(show(remote, "feat/a/one.png"), "new:one.png");
    assert.equal(show(remote, "release/b/x.png"), "png:x.png");

    const before = tip(remote);
    const again = await publish(remote, results(["one.png"], "new"), "feat/a");
    assert.equal(again.code, 0, again.output);
    assert.match(again.output, /unchanged; nothing to publish/);
    assert.equal(tip(remote), before, "no new commit");
  });

  it("two runs pushing at the same instant both publish: the rejected push is retried on the new tip", async () => {
    const remote = bareRemote();
    assert.equal((await publish(remote, results(["base.png"]), "main")).code, 0);
    const base = tip(remote);
    // Both runs fetch the same tip, commit, and wait for each other before their first push.
    const barrier = path.join(root, `barrier-${++counter}`);
    mkdirSync(barrier);
    const hook = 'if [ "$PUBLISH_ATTEMPT" = 1 ]; then touch "$BARRIER/$RUN"; for i in $(seq 400); do [ "$(ls "$BARRIER" | wc -l)" -ge 2 ] && break; sleep 0.05; done; fi';
    const [c, d] = await Promise.all([
      publish(remote, results(["c.png"]), "feat/c", { PUBLISH_BEFORE_PUSH: hook, BARRIER: slash(barrier), RUN: "c" }),
      publish(remote, results(["d.png"]), "feat/d", { PUBLISH_BEFORE_PUSH: hook, BARRIER: slash(barrier), RUN: "d" }),
    ]);
    assert.equal(c.code, 0, c.output);
    assert.equal(d.code, 0, d.output);
    const outputs = c.output + d.output;
    assert.equal((outputs.match(/Attempt 1: push rejected/g) ?? []).length, 1, outputs);
    assert.match(outputs, /attempt 1 of 5/);
    assert.match(outputs, /attempt 2 of 5/);
    assert.deepEqual(files(remote), ["feat/c/README.md", "feat/c/c.png", "feat/d/README.md", "feat/d/d.png", "main/README.md", "main/base.png"]);
    assert.ok(isAncestor(remote, base, tip(remote)));
  });

  it("retries a transient rejection, and fails (without printing the remote) when every attempt fails", async () => {
    const remote = bareRemote("SECRET-MARKER-remote");
    assert.equal((await publish(remote, results(["first.png"]), "feat/e")).code, 0);
    rejectPushes(remote, 1);
    const recovered = await publish(remote, results(["second.png"]), "feat/e");
    assert.equal(recovered.code, 0, recovered.output);
    assert.match(recovered.output, /attempt 2 of 5/);
    assert.deepEqual(files(remote), ["feat/e/README.md", "feat/e/second.png"]);

    rejectPushes(remote, 99);
    const before = tip(remote);
    const failed = await publish(remote, results(["third.png"]), "feat/e", { PUBLISH_ATTEMPTS: "3" });
    assert.equal(failed.code, 1, failed.output);
    assert.equal((failed.output.match(/push rejected/g) ?? []).length, 3);
    assert.match(failed.output, /::error title=Screenshots not published::Could not publish to ci-artifacts\/feat\/e after 3 attempts/);
    assert.equal(tip(remote), before, "nothing published");
    assert.ok(!failed.output.includes("SECRET-MARKER"), `the remote is redacted:\n${failed.output}`);
    assert.match(failed.output, /<remote>|temporarily unavailable/);
  });

  it("publishes nothing without screenshots, and refuses unsafe directory names", async () => {
    const remote = bareRemote();
    const empty = path.join(root, `empty-${++counter}`);
    mkdirSync(empty);
    for (const dir of [slash(empty), slash(path.join(root, "does-not-exist"))]) {
      const run = await publish(remote, dir, "feat/x");
      assert.equal(run.code, 0, run.output);
      assert.match(run.output, /No screenshots produced/);
    }
    assert.equal(tip(remote), "", "no branch created");
    for (const dest of ["../escape", "/abs", "feat/../x", "a/.git/b", "", "a//b"]) {
      const run = await publish(remote, results(["p.png"]), dest);
      assert.equal(run.code, 2, `${dest}: ${run.output}`);
    }
    assert.equal(tip(remote), "");
  });
});
