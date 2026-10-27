/*
 * Syntax colouring for the firmware editor. The source is split into tokens
 * (comments, string and character literals, preprocessor directives,
 * numbers, keywords, types, names in capitals such as register and macro
 * names, and function names) and rendered as HTML for a layer drawn under
 * the editor's transparent text. Text is only ever escaped, never
 * interpreted; the layer has exactly the characters of the source, so it
 * lines up with the textarea character for character.
 */

const KEYWORDS = new Set([
  "auto", "break", "case", "const", "continue", "default", "do", "else", "enum", "extern", "for", "goto", "if",
  "inline", "register", "restrict", "return", "sizeof", "static", "struct", "switch", "typedef", "union",
  "volatile", "while", "_Static_assert", "_Alignas", "_Alignof", "_Noreturn", "asm", "__asm", "__asm__",
  "__attribute__", "__volatile__",
]);

const TYPES = new Set([
  "void", "char", "short", "int", "long", "float", "double", "signed", "unsigned", "_Bool", "bool",
  "size_t", "ptrdiff_t", "uintptr_t", "intptr_t",
  "uint8_t", "uint16_t", "uint32_t", "uint64_t", "int8_t", "int16_t", "int32_t", "int64_t",
]);

const IDENT_START = /[A-Za-z_]/;
const IDENT = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;
const NUMBER = /^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+\.?[0-9]*(?:[eE][+-]?[0-9]+)?|\.[0-9]+(?:[eE][+-]?[0-9]+)?)[uUlLfF]*/;

/**
 * Splits C source into [{ kind, text }]; joining the texts gives the source
 * back unchanged. Kinds: plain, comment, string, preprocessor, number,
 * keyword, type, constant (a name in capitals), function.
 */
export function tokenize(source) {
  const tokens = [];
  const push = (kind, text) => {
    const last = tokens.at(-1);
    if (last && last.kind === kind && kind === "plain") {
      last.text += text;
    } else {
      tokens.push({ kind, text });
    }
  };
  const length = source.length;
  let i = 0;
  let lineStart = true; // only whitespace so far on this line
  while (i < length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "\n") {
      push("plain", c);
      i += 1;
      lineStart = true;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v") {
      let end = i + 1;
      while (end < length && " \t\r\f\v".includes(source[end])) {
        end += 1;
      }
      push("plain", source.slice(i, end));
      i = end;
      continue;
    }
    let end;
    if (c === "/" && next === "/") {
      end = source.indexOf("\n", i);
      end = end === -1 ? length : end;
      push("comment", source.slice(i, end));
    } else if (c === "/" && next === "*") {
      end = source.indexOf("*/", i + 2);
      end = end === -1 ? length : end + 2;
      push("comment", source.slice(i, end));
    } else if (c === "#" && lineStart) {
      // A directive up to the end of its line (with backslash continuations), or up to a comment.
      end = i + 1;
      while (end < length) {
        const ch = source[end];
        if (ch === "\n" && source[end - 1] !== "\\") {
          break;
        }
        if (ch === "/" && (source[end + 1] === "/" || source[end + 1] === "*")) {
          break;
        }
        end += 1;
      }
      push("preprocessor", source.slice(i, end));
    } else if (c === '"' || c === "'") {
      end = i + 1;
      while (end < length && source[end] !== c && source[end] !== "\n") {
        end += source[end] === "\\" ? 2 : 1;
      }
      end = Math.min(length, source[end] === c ? end + 1 : end);
      push("string", source.slice(i, end));
    } else if (DIGIT.test(c) || (c === "." && DIGIT.test(next ?? ""))) {
      const match = NUMBER.exec(source.slice(i, i + 64));
      end = i + (match ? match[0].length : 1);
      push("number", source.slice(i, end));
    } else if (IDENT_START.test(c)) {
      end = i + 1;
      while (end < length && IDENT.test(source[end])) {
        end += 1;
      }
      const word = source.slice(i, end);
      let after = end;
      while (after < length && (source[after] === " " || source[after] === "\t")) {
        after += 1;
      }
      let kind = "plain";
      if (KEYWORDS.has(word)) {
        kind = "keyword";
      } else if (TYPES.has(word)) {
        kind = "type";
      } else if (word.length > 1 && /^[A-Z][A-Z0-9_]*$/.test(word)) {
        kind = "constant";
      } else if (source[after] === "(") {
        kind = "function";
      }
      push(kind, word);
    } else {
      end = i + 1;
      push("plain", c);
    }
    i = end;
    lineStart = false;
  }
  return tokens;
}

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/** HTML for the colouring layer; a final newline gets a space so the layer is as tall as the textarea. */
export function highlightHtml(source) {
  const html = tokenize(source)
    .map(({ kind, text }) => (kind === "plain" ? escapeHtml(text) : `<span class="tok-${kind}">${escapeHtml(text)}</span>`))
    .join("");
  return source.endsWith("\n") || source === "" ? `${html} ` : html;
}
