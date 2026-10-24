/*
 * Compiler diagnostics for the editor: grouping, locations, gutter marks,
 * and the text range to select for a problem. Pure functions (no DOM), so
 * they are unit-tested in Node.
 *
 * A diagnostic is { file, line, column, severity, message, origin } as the
 * orchestrator reports it; `line` and `column` are null when the tool gave
 * none (linker and driver errors). Nothing here invents a location: only a
 * diagnostic in main.c with a line can be navigated to.
 */

export const SOURCE_NAME = "main.c";

/**
 * Errors and warnings in the order reported, each with the notes that
 * followed it ("note: previous declaration is here"). A note before any
 * error or warning is kept as its own entry.
 */
export function groupDiagnostics(diagnostics) {
  const problems = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "note" && problems.length) {
      problems.at(-1).notes.push(diagnostic);
    } else {
      problems.push({ ...diagnostic, notes: [] });
    }
  }
  return problems;
}

/** True when the diagnostic points at a line of the editor's file. */
export function isNavigable(diagnostic, sourceName = SOURCE_NAME) {
  return diagnostic.file === sourceName && Number.isInteger(diagnostic.line) && diagnostic.line > 0;
}

/** "main.c:12:5", "main.c:15", "startup.s:7", "main.c (no line)", or "linker" / "compiler" when there is no file. */
export function describeLocation(diagnostic) {
  if (!diagnostic.file) {
    return diagnostic.origin ?? "compiler";
  }
  if (!Number.isInteger(diagnostic.line)) {
    return `${diagnostic.file} (no line)`;
  }
  return Number.isInteger(diagnostic.column) ? `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}` : `${diagnostic.file}:${diagnostic.line}`;
}

/** "2 errors, 1 warning" (empty string for none). */
export function summarize(problems) {
  const count = (severity) => problems.filter((p) => p.severity === severity).length;
  const parts = [];
  for (const [severity, n] of [["error", count("error")], ["warning", count("warning")]]) {
    if (n) {
      parts.push(`${n} ${severity}${n === 1 ? "" : "s"}`);
    }
  }
  return parts.join(", ");
}

/**
 * Gutter marks for the editor's file: Map(line → { severity, messages }),
 * the worst severity on each line (error over warning over note).
 */
export function lineMarks(problems, sourceName = SOURCE_NAME) {
  const rank = { error: 3, warning: 2, note: 1 };
  const marks = new Map();
  for (const diagnostic of problems.flatMap((p) => [p, ...(p.notes ?? [])])) {
    if (!isNavigable(diagnostic, sourceName)) {
      continue;
    }
    const mark = marks.get(diagnostic.line) ?? { severity: "note", messages: [] };
    if ((rank[diagnostic.severity] ?? 0) > rank[mark.severity]) {
      mark.severity = diagnostic.severity;
    }
    mark.messages.push(`${diagnostic.severity}: ${diagnostic.message}`);
    marks.set(diagnostic.line, mark);
  }
  return marks;
}

/**
 * Text offsets to select for a problem: the identifier or symbol at its
 * line and column (GCC columns count from 1), or the line's code when there
 * is no column. Lines and columns past the end are clamped. Returns
 * { start, end, line }, `line` being the line actually selected.
 */
export function problemRange(text, line, column = null) {
  const lines = text.split("\n");
  const index = Math.min(Math.max(1, line), lines.length) - 1;
  const lineStart = lines.slice(0, index).reduce((sum, row) => sum + row.length + 1, 0);
  const row = lines[index];
  if (!Number.isInteger(column)) {
    const indent = row.length - row.trimStart().length;
    return { start: lineStart + indent, end: lineStart + row.trimEnd().length, line: index + 1 };
  }
  const at = Math.min(Math.max(0, column - 1), row.length);
  let end = at;
  while (end < row.length && /\w/.test(row[end])) {
    end++;
  }
  if (end === at && at < row.length) {
    end = at + 1; // a symbol such as ';' or '}'
  }
  return { start: lineStart + at, end: lineStart + end, line: index + 1 };
}

/**
 * The next (direction 1) or previous (-1) navigable problem after the
 * editor's current line, wrapping around; null when there is none.
 */
export function nextProblem(problems, currentLine, direction = 1, sourceName = SOURCE_NAME) {
  const located = problems.filter((p) => isNavigable(p, sourceName));
  if (!located.length) {
    return null;
  }
  const ordered = [...located].sort((a, b) => a.line - b.line || (a.column ?? 0) - (b.column ?? 0));
  if (direction > 0) {
    return ordered.find((p) => p.line > currentLine) ?? ordered[0];
  }
  return [...ordered].reverse().find((p) => p.line < currentLine) ?? ordered.at(-1);
}
