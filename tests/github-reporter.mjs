/*
 * node:test reporter that turns failures into GitHub Actions annotations,
 * so CI failures are visible on the run page and through the public
 * check-runs API without downloading logs.
 *
 *   node --test --test-reporter=spec --test-reporter-destination=stdout \
 *        --test-reporter=./tests/github-reporter.mjs --test-reporter-destination=stdout
 */
import path from "node:path";

function escapeData(text) {
  return String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(text) {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export default async function* githubReporter(source) {
  let failures = 0;
  for await (const event of source) {
    if (event.type !== "test:fail") {
      continue;
    }
    const { data } = event;
    // Suites report their children's failures again; annotate leaf tests only.
    if (data.details?.type === "suite") {
      continue;
    }
    failures++;
    if (failures > 40) {
      continue;
    }
    const error = data.details?.error;
    const cause = error?.cause ?? error;
    const message = [cause?.message ?? String(cause ?? "failed"), cause?.expected !== undefined ? `expected: ${JSON.stringify(cause.expected)}` : "", cause?.actual !== undefined ? `actual: ${JSON.stringify(cause.actual)}` : ""]
      .filter(Boolean)
      .join("\n")
      .slice(0, 3000);
    const file = data.file ? path.relative(process.cwd(), data.file.replace(/^file:\/\//, "")) : "";
    const location = file ? `file=${escapeProperty(file)}${data.line ? `,line=${data.line}` : ""},` : "";
    yield `::error ${location}title=${escapeProperty(`Test failed: ${data.name}`.slice(0, 200))}::${escapeData(message)}\n`;
  }
}
