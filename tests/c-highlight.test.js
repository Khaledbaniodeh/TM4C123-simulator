/*
 * Syntax colouring of firmware source (apps/web/c-highlight.js): token
 * kinds on real example code, round-tripping, and escaping.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { highlightHtml, tokenize } from "../apps/web/c-highlight.js";

const kinds = (source) => tokenize(source).filter((t) => t.kind !== "plain").map((t) => `${t.kind}:${t.text}`);

describe("firmware editor syntax colouring", () => {
  it("gives every example back exactly when its tokens are joined", async () => {
    for (const id of ["gpiof-red-led", "three-timers", "lcd1602-hello", "adc-potentiometer", "lab-gpio-interrupts"]) {
      const source = await readFile(new URL(`../examples/${id}/main.c`, import.meta.url), "utf8");
      assert.equal(tokenize(source).map((t) => t.text).join(""), source, id);
    }
  });

  it("recognises comments, directives, strings, numbers, keywords, types, constants, and calls", () => {
    const source = [
      '#include "TM4C123.h"',
      "#define PF1_RED_LED (1u << 1) /* PF1 */",
      "static volatile uint32_t g_ticks = 0x1Fu; // counter",
      "int main(void)",
      "{",
      "    SYSCTL->RCGCGPIO |= (1u << 5);",
      "    lcd_print(\"Hi \\\"there\\\"\", 'x', 3.5f);",
      "    return 0;",
      "}",
    ].join("\n");
    assert.deepEqual(kinds(source), [
      'preprocessor:#include "TM4C123.h"',
      "preprocessor:#define PF1_RED_LED (1u << 1) ",
      "comment:/* PF1 */",
      "keyword:static", "keyword:volatile", "type:uint32_t", "number:0x1Fu", "comment:// counter",
      "type:int", "function:main", "type:void",
      "constant:SYSCTL", "constant:RCGCGPIO", "number:1u", "number:5",
      "function:lcd_print", 'string:"Hi \\"there\\""', "string:'x'", "number:3.5f",
      "keyword:return", "number:0",
    ]);
  });

  it("keeps a block comment across lines and an unterminated one to the end", () => {
    assert.deepEqual(kinds("a /* one\ntwo */ b"), ["comment:/* one\ntwo */"]);
    assert.deepEqual(kinds("x /* open"), ["comment:/* open"]);
    assert.deepEqual(kinds('s = "no end\nnext'), ['string:"no end']);
  });

  it("treats # as a directive only at the start of a line", () => {
    assert.deepEqual(kinds("  #if DEBUG\nx # y"), ["preprocessor:#if DEBUG"]);
    assert.deepEqual(kinds("#define A \\\n  1\nOK"), ["preprocessor:#define A \\\n  1", "constant:OK"]);
  });

  it("escapes markup and keeps the layer as tall as the text", () => {
    const html = highlightHtml('char *s = "<b>&</b>";\n');
    assert.ok(html.includes("&lt;b&gt;&amp;&lt;/b&gt;"));
    assert.ok(!html.includes("<b>"));
    assert.ok(html.endsWith(" "));
    assert.equal(highlightHtml(""), " ");
  });
});
