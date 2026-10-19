#!/usr/bin/env python3
"""
Verify apps/web/board/ek-tm4c123gxl.pins.json against TI's EK-TM4C123GXL
User's Guide (SPMU296) BoosterPack connector tables.

Runs in CI only: SPMU296 is downloaded on the runner and converted with
`pdftotext -layout`. Only short matching lines are echoed as annotations.

Usage:
    check_pinmap.py spmu296.txt apps/web/board/ek-tm4c123gxl.pins.json
"""
import json
import re
import sys


def escape(text):
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def annotate(kind, title, lines, limit=3800):
    chunk, part = "", 1
    for line in (escape(l) for l in lines):
        if len(chunk) + len(line) + 3 > limit:
            print(f"::{kind} title={title} ({part})::{chunk}")
            chunk, part = "", part + 1
        chunk += ("%0A" if chunk else "") + line
    if chunk:
        print(f"::{kind} title={title} ({part})::{chunk}")


def normalize(text):
    return re.sub(r"\s+", " ", text.replace("–", "-")).strip()


def expected_token(entry):
    if "gpio" in entry:
        return entry["gpio"]
    signal = entry["signal"]
    return {"3.3V": "3.3", "5V": "5", "GND": "GND", "RESET": "RESET"}.get(signal, signal)


def main():
    text_path, pins_path = sys.argv[1], sys.argv[2]
    with open(text_path, encoding="utf-8", errors="replace") as handle:
        lines = [normalize(line) for line in handle]
    with open(pins_path, encoding="utf-8") as handle:
        pinmap = json.load(handle)

    failures, evidence = [], []
    for header, entries in pinmap["headers"].items():
        number = header[1:]
        for entry in entries:
            # SPMU296 numbers connector pins as "<header>.<pin>", e.g. 1.02 for J1 pin 2.
            label = f"{number}.{entry['pin']:02d}"
            pattern = re.compile(rf"(^|\s){re.escape(label)}(\s|$)")
            rows = [line for line in lines if pattern.search(line)]
            token = expected_token(entry).upper()
            match = next((row for row in rows if token in row.upper()), None)
            if match:
                evidence.append(f"{header}.{entry['pin']} {expected_token(entry)} <= {match[:160]}")
            else:
                failures.append(f"{header}.{entry['pin']} expected {expected_token(entry)}; rows with {label}: "
                                + (" | ".join(r[:120] for r in rows[:3]) or "none"))

    context = [line[:200] for line in lines if re.search(r"\bJ[1-4]\b", line)][:60]
    annotate("notice", "SPMU296 lines mentioning J1-J4", context)
    annotate("notice", "Pin map evidence", evidence)
    if failures:
        annotate("error", "Pin map mismatches", failures)
        sys.exit(1)
    print(f"All {len(evidence)} header pins match SPMU296.")


if __name__ == "__main__":
    main()
