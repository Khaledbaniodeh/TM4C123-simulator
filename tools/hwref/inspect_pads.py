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
        # "*REMARK*" lines are comments describing field layout, not sections.
        if match and match.group(1) != "REMARK":
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


TOOL = re.compile(r"^T(\d+)(?:C([\d.]+))?")


def drill(archive):
    """Tool table, the .lst report, and every non-via hit (vias are the smallest tool)."""
    gerbers = member(archive, "Gerbers.zip")
    with zipfile.ZipFile(io.BytesIO(archive.read(gerbers))) as inner:
        for name in inner.namelist():
            if name.lower().endswith(".lst"):
                annotate("notice", "Drill list (.lst)", inner.read(name).decode("latin-1").splitlines()[:90])
        for name in inner.namelist():
            if not name.lower().endswith(".drl"):
                continue
            text = inner.read(name).decode("latin-1").splitlines()
            annotate("notice", "Drill header", [line for line in text if not re.match(r"^X", line.strip())][:40])
            diameters, hits, current = {}, collections.defaultdict(list), None
            for line in text:
                line = line.strip()
                tool = TOOL.match(line)
                if tool:
                    current = tool.group(1)
                    if tool.group(2):
                        diameters[current] = float(tool.group(2))
                    continue
                if current and re.match(r"^X[-\d.]+Y[-\d.]+", line):
                    hits[current].append(line)
            annotate("notice", "Drill tools", [f"T{t} dia={diameters.get(t)} hits={len(h)}" for t, h in sorted(hits.items(), key=lambda kv: int(kv[0]))])
            smallest = min(hits, key=lambda t: diameters.get(t, 0)) if hits else None
            for tool, rows in sorted(hits.items(), key=lambda kv: int(kv[0])):
                if tool == smallest:
                    continue
                annotate("notice", f"Drill T{tool} dia={diameters.get(tool)}", rows)


def board_outline_gerber(archive):
    gerbers = member(archive, "Gerbers.zip")
    with zipfile.ZipFile(io.BytesIO(archive.read(gerbers))) as inner:
        name = next(n for n in inner.namelist() if "boardoutline" in n.lower())
        annotate("notice", "Board outline Gerber", inner.read(name).decode("latin-1").splitlines())


def parts(archive):
    """Part placements. PADS 'BASIC' units: 38100 per mil."""
    _, lines = ascii_lines(archive)
    secs = sections(lines)
    rows = []
    for _, line in secs.get("PART", []):
        tokens = line.split()
        if len(tokens) >= 5 and re.match(r"^[A-Z]+\d+$", tokens[0]):
            try:
                x_mil = float(tokens[2]) / 38100.0
                y_mil = float(tokens[3]) / 38100.0
                rows.append(f"{tokens[0]} {tokens[1]} x={x_mil:.1f}mil y={y_mil:.1f}mil ori={tokens[4]} {' '.join(tokens[5:8])}")
            except ValueError:
                rows.append(" ".join(tokens[:8]))
    # Everything except plain resistors, capacitors, and single header pins:
    # short enough to fit one annotation, so no part is lost to truncation.
    active = [row for row in rows if not re.search(r"\s(RESC|CAPC|HDR-)", row)]
    annotate("notice", "PADS non-passive parts", active)
    annotate("notice", "PADS part types", sorted({row.split()[1] for row in rows if len(row.split()) > 1}))


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
            board_outline_gerber(archive)
        elif mode == "drill":
            drill(archive)
    except Exception:
        import traceback
        annotate("error", f"inspect_pads {mode} failed", traceback.format_exc().splitlines()[-12:])
        sys.exit(1)


if __name__ == "__main__":
    main()
