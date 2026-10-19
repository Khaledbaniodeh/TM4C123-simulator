#!/usr/bin/env python3
"""
Extract EK-TM4C123GXL geometry from TI's Rev A design package (SPMR240),
which is a PADS 9.3 design:

  - "EK-TM4C123GXL Rev A ASCII.asc"  PADS ASCII export (text): units,
    part placement (*PART*), board outline (*LINES* ... BOARD)
  - "EK-TM4C123GXL Rev A Gerbers.zip": Excellon drill file with the exact
    through-hole coordinates (header pins, mounting holes)
  - "EK-TM4C123GXL Rev A Schematic.pdf": net names (checked with pdftotext)

CI-only. Reports derived facts as GitHub annotations; never commits TI files.

Usage: inspect_pads.py SPMR240.zip <discover|parts|outline|drill>
"""
import collections
import io
import re
import sys
import zipfile

MAX = 3800


def escape(text):
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def annotate(kind, title, lines):
    chunk, part = "", 1
    for line in (escape(str(l)) for l in lines):
        if len(chunk) + len(line) + 3 > MAX:
            print(f"::{kind} title={title} ({part})::{chunk}")
            chunk, part = "", part + 1
        chunk += ("%0A" if chunk else "") + line
    if chunk:
        print(f"::{kind} title={title} ({part})::{chunk}")


def member(archive, suffix):
    for name in archive.namelist():
        if name.lower().endswith(suffix.lower()):
            return name
    return None


def ascii_lines(archive):
    name = member(archive, ".asc")
    text = archive.read(name).decode("latin-1")
    return name, text.splitlines()


def sections(lines):
    """Maps '*SECTION*' -> list of (index, line) until the next section."""
    result = collections.OrderedDict()
    current = None
    for index, line in enumerate(lines):
        match = re.match(r"^\*([A-Z_]+)\*", line)
        if match:
            current = match.group(1)
            result.setdefault(current, [])
            continue
        if current:
            result[current].append((index, line))
    return result


INTERESTING = re.compile(r"^(J\d+|SW\d+|D\d+|U\d+|R9|R10|Y\d+|H\d+|MH\d+|LED\d*)$")


def discover(archive):
    name, lines = ascii_lines(archive)
    secs = sections(lines)
    annotate("notice", "PADS header", [name] + lines[:12])
    annotate("notice", "PADS sections", [f"{k}: {len(v)} lines" for k, v in secs.items()])
    pcb = [line for _, line in secs.get("PCB", [])][:40]
    annotate("notice", "PADS *PCB* section", pcb)
    part_lines = [line for _, line in secs.get("PART", [])]
    sample = [l for l in part_lines if l.split() and INTERESTING.match(l.split()[0])]
    annotate("notice", "PADS *PART* lines for J/SW/D/U/R9/R10/Y/H", sample[:80])
    gerbers = member(archive, "Gerbers.zip")
    if gerbers:
        with zipfile.ZipFile(io.BytesIO(archive.read(gerbers))) as inner:
            annotate("notice", "Gerber package", [f"{i.filename} ({i.file_size} B)" for i in inner.infolist()])


def outline(archive):
    _, lines = ascii_lines(archive)
    secs = sections(lines)
    rows = [line for _, line in secs.get("LINES", [])]
    out, take = [], 0
    for line in rows:
        if re.search(r"\bBOARD\b", line):
            take = 30
        if take:
            out.append(line)
            take -= 1
    annotate("notice", "PADS board outline (*LINES* BOARD)", out[:120] or ["no BOARD lines found"])


def drill(archive):
    gerbers = member(archive, "Gerbers.zip")
    with zipfile.ZipFile(io.BytesIO(archive.read(gerbers))) as inner:
        names = [n for n in inner.namelist() if re.search(r"(drl|drill|\.txt|\.nc|\.xln|\.exc)$", n, re.I)]
        report = []
        for name in names:
            text = inner.read(name).decode("latin-1")
            head = text.splitlines()[:25]
            report.append(f"== {name}")
            report.extend(head)
            # Tool table and hit counts per tool.
            tools = collections.Counter()
            current = None
            for line in text.splitlines():
                tool = re.match(r"^T(\d+)$", line.strip())
                if tool:
                    current = tool.group(1)
                elif re.match(r"^X[-\d.]+Y[-\d.]+", line.strip()) and current:
                    tools[current] += 1
            report.append("hits per tool: " + ", ".join(f"T{t}={n}" for t, n in sorted(tools.items())))
        annotate("notice", "Drill files", report)


def drill_hits(archive, wanted_tools):
    """Prints all hits for the given tools (e.g. header pin tool)."""
    gerbers = member(archive, "Gerbers.zip")
    with zipfile.ZipFile(io.BytesIO(archive.read(gerbers))) as inner:
        for name in inner.namelist():
            if not re.search(r"(drl|drill|\.txt|\.nc|\.xln|\.exc)$", name, re.I):
                continue
            current, hits = None, []
            for line in inner.read(name).decode("latin-1").splitlines():
                line = line.strip()
                tool = re.match(r"^T(\d+)$", line)
                if tool:
                    current = tool.group(1)
                elif current in wanted_tools and re.match(r"^X[-\d.]+Y[-\d.]+", line):
                    hits.append(f"T{current} {line}")
            annotate("notice", f"Drill hits {name}", hits)


def parts(archive):
    _, lines = ascii_lines(archive)
    secs = sections(lines)
    rows = []
    for _, line in secs.get("PART", []):
        tokens = line.split()
        if len(tokens) >= 5 and re.match(r"^[A-Z]+\d+$", tokens[0]):
            rows.append(" ".join(tokens[:8]))
    annotate("notice", "All PADS parts (name type x y ori ...)", rows)


def main():
    path, mode = sys.argv[1], sys.argv[2]
    with open(path, "rb") as handle:
        archive = zipfile.ZipFile(io.BytesIO(handle.read()))
    try:
        if mode == "discover":
            discover(archive)
        elif mode == "parts":
            parts(archive)
        elif mode == "outline":
            outline(archive)
        elif mode == "drill":
            drill(archive)
        elif mode == "hits":
            drill_hits(archive, set(sys.argv[3].split(",")))
    except Exception:
        import traceback
        annotate("error", f"inspect_pads {mode} failed", traceback.format_exc().splitlines()[-12:])
        sys.exit(1)


if __name__ == "__main__":
    main()
