/*
 * Editor diagnostics: grouping, locations, gutter marks, the text selected for
 * a problem, and next/previous navigation. Pure module, no browser.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeLocation,
  groupDiagnostics,
  isNavigable,
  lineMarks,
  nextProblem,
  problemRange,
  summarize,
} from "../apps/web/diagnostics.js";

const error = (line, column, message = "boom") => ({ file: "main.c", line, column, severity: "error", message, origin: "compiler" });
const warning = (line, column, message = "hmm") => ({ file: "main.c", line, column, severity: "warning", message, origin: "compiler" });
const note = (line, column, message = "see here") => ({ file: "main.c", line, column, severity: "note", message, origin: "compiler" });
const linker = (message, line = null) => ({ file: line ? "main.c" : null, line, column: null, severity: "error", message, origin: "linker" });

describe("editor diagnostics", () => {
  it("keeps notes with the problem before them", () => {
    const problems = groupDiagnostics([note(1, 1, "orphan"), error(12, 5), note(3, 9), warning(20, 9), linker("ld returned 1 exit status")]);
    assert.deepEqual(problems.map((p) => [p.severity, p.line, p.notes.length]), [["note", 1, 0], ["error", 12, 1], ["warning", 20, 0], ["error", null, 0]]);
    assert.equal(problems[1].notes[0].line, 3);
  });

  it("navigates only to lines of main.c that the tool reported", () => {
    assert.equal(isNavigable(error(12, 5)), true);
    assert.equal(isNavigable(linker("undefined reference to `foo'", 15)), true, "a line the linker took from debug info");
    assert.equal(isNavigable(linker("undefined reference to `bar'")), false);
    assert.equal(isNavigable({ ...error(7, null), file: "startup.s" }), false, "another file");
    assert.equal(isNavigable({ ...error(0, 1) }), false);
  });

  it("describes where a problem is without inventing a location", () => {
    assert.equal(describeLocation(error(12, 5)), "main.c:12:5");
    assert.equal(describeLocation(linker("undefined reference to `foo'", 15)), "main.c:15");
    assert.equal(describeLocation({ ...linker("x"), file: "main.c" }), "main.c (no line)");
    assert.equal(describeLocation(linker("region `FLASH' overflowed by 4 bytes")), "linker");
    assert.equal(describeLocation({ file: null, line: null, column: null, severity: "error", message: "bad option" }), "compiler");
  });

  it("summarizes errors and warnings", () => {
    assert.equal(summarize([]), "");
    assert.equal(summarize(groupDiagnostics([error(1, 1), note(1, 1), warning(2, 1)])), "1 error, 1 warning");
    assert.equal(summarize(groupDiagnostics([error(1, 1), error(2, 1), linker("x"), warning(3, 1), warning(4, 1)])), "3 errors, 2 warnings");
  });

  it("marks each problem line once, with its worst severity and every message", () => {
    const marks = lineMarks(groupDiagnostics([warning(12, 1, "unused"), error(12, 5, "undeclared"), note(3, 9, "declared here"), linker("no line")]));
    assert.deepEqual([...marks.keys()].sort((a, b) => a - b), [3, 12]);
    assert.deepEqual(marks.get(12), { severity: "error", messages: ["warning: unused", "error: undeclared"] });
    assert.deepEqual(marks.get(3), { severity: "note", messages: ["note: declared here"] });
  });

  it("selects the identifier or symbol at the problem's column, or the line's code without a column", () => {
    const text = "int main(void)\n{\n    value = undeclared_identifier;\n    x = 1\n}";
    assert.deepEqual(problemRange(text, 3, 13), { start: text.indexOf("undeclared_identifier"), end: text.indexOf("undeclared_identifier") + 21, line: 3 });
    const semicolon = text.indexOf(";");
    assert.deepEqual(problemRange(text, 3, 34), { start: semicolon, end: semicolon + 1, line: 3 }, "a symbol: one character");
    assert.deepEqual(problemRange(text, 4, null), { start: text.indexOf("x = 1"), end: text.indexOf("x = 1") + 5, line: 4 });
    // Past the end (the code changed since the build): clamped, never outside the text.
    assert.deepEqual(problemRange(text, 99, 1), { start: text.length - 1, end: text.length, line: 5 });
    assert.deepEqual(problemRange(text, 1, 99), { start: 14, end: 14, line: 1 });
  });

  it("goes to the next or previous problem line, wrapping around, skipping problems without a line", () => {
    const problems = groupDiagnostics([error(20, 1), linker("no line"), warning(5, 3), error(12, 5)]);
    assert.equal(nextProblem(problems, 1).line, 5);
    assert.equal(nextProblem(problems, 5).line, 12);
    assert.equal(nextProblem(problems, 20).line, 5, "wraps to the first");
    assert.equal(nextProblem(problems, 12, -1).line, 5);
    assert.equal(nextProblem(problems, 5, -1).line, 20, "wraps to the last");
    assert.equal(nextProblem(groupDiagnostics([linker("no line")]), 1), null);
  });
});
