#!/usr/bin/env python3
"""
Extract board geometry from TI's EK-TM4C123GXL EAGLE design files (SPMR240).

Runs in CI only. The TI archive is downloaded on the runner and never stored
in the repository; only derived facts (dimensions, part positions, header
pad coordinates) are reported, as GitHub annotations and as JSON on stdout.

Usage:
    extract_brd.py SPMR240.zip summary   # outline + list of all parts
    extract_brd.py SPMR240.zip headers   # pad coordinates of connectors/switches/LEDs
    extract_brd.py SPMR240.zip json      # everything as JSON (for later steps)
"""
import io
import json
import math
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

MAX_ANNOTATION = 3800  # stay well below GitHub's annotation message limit


def escape(text):
    """Escape a workflow-command message (see GitHub Actions docs)."""
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def annotate(kind, title, lines):
    """Emit one or more ::notice annotations, splitting long content."""
    chunk, part = "", 1
    for line in (escape(line) for line in lines):
        if len(chunk) + len(line) + 3 > MAX_ANNOTATION:
            print(f"::{kind} title={title} ({part})::{chunk}")
            chunk, part = "", part + 1
        chunk += ("%0A" if chunk else "") + line
    if chunk:
        print(f"::{kind} title={title} ({part})::{chunk}")


def find_brd(data, depth=0):
    """Return (name, bytes) of the first .brd file, searching nested zips."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for name in archive.namelist():
            if name.lower().endswith(".brd"):
                return name, archive.read(name), archive.namelist()
        if depth < 2:
            for name in archive.namelist():
                if name.lower().endswith(".zip"):
                    found = find_brd(archive.read(name), depth + 1)
                    if found:
                        return found
    return None


def parse_rotation(rot):
    """EAGLE rotation strings: 'R90', 'MR180', 'SR270' ... -> (degrees, mirrored)."""
    if not rot:
        return 0.0, False
    match = re.match(r"^S?(M?)R?([0-9.]+)$", rot)
    if not match:
        return 0.0, False
    return float(match.group(2)), bool(match.group(1))


def transform(px, py, ex, ey, rot):
    degrees, mirrored = parse_rotation(rot)
    if mirrored:
        px = -px
    rad = math.radians(degrees)
    x = px * math.cos(rad) - py * math.sin(rad)
    y = px * math.sin(rad) + py * math.cos(rad)
    return ex + x, ey + y


def extract(brd_bytes):
    root = ET.fromstring(brd_bytes)
    board = root.find("./drawing/board")

    outline = []
    for wire in board.findall("./plain/wire"):
        if wire.get("layer") == "20":
            outline.extend([(float(wire.get("x1")), float(wire.get("y1"))),
                            (float(wire.get("x2")), float(wire.get("y2")))])
    xs, ys = [p[0] for p in outline], [p[1] for p in outline]
    bbox = {"minX": min(xs), "minY": min(ys), "maxX": max(xs), "maxY": max(ys)} if outline else None

    packages = {}
    for library in board.findall("./libraries/library"):
        for package in library.findall("./packages/package"):
            pads = []
            for pad in package.findall("pad"):
                pads.append((pad.get("name"), float(pad.get("x")), float(pad.get("y")), "tht"))
            for smd in package.findall("smd"):
                pads.append((smd.get("name"), float(smd.get("x")), float(smd.get("y")), "smd"))
            packages[(library.get("name"), package.get("name"))] = pads

    elements = []
    for element in board.findall("./elements/element"):
        ex, ey = float(element.get("x")), float(element.get("y"))
        rot = element.get("rot", "R0")
        pads = []
        for name, px, py, kind in packages.get((element.get("library"), element.get("package")), []):
            ax, ay = transform(px, py, ex, ey, rot)
            pads.append({"name": name, "x": round(ax, 3), "y": round(ay, 3), "kind": kind})
        elements.append({
            "name": element.get("name"),
            "value": element.get("value"),
            "package": element.get("package"),
            "library": element.get("library"),
            "x": ex, "y": ey, "rot": rot,
            "pads": pads,
        })

    unit = "mm"
    grid = root.find("./drawing/grid")
    if grid is not None and grid.get("unit"):
        unit = f"mm (grid display unit {grid.get('unit')})"

    return {"bbox": bbox, "unit": unit, "elements": elements}


INTERESTING = re.compile(r"^(J\d+|SW\d+|S\d+|D\d+|LED\d*|U\d+|R9|R10|Y\d+|H\d+|P\d+|USB\d*|CON\d*)$", re.I)


def describe_archive(data):
    """Short diagnostic of what was downloaded (for annotations)."""
    head = data[:16]
    lines = [f"bytes={len(data)} magic={head!r}"]
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for info in archive.infolist()[:60]:
                lines.append(f"{info.filename} ({info.file_size} B)")
    except zipfile.BadZipFile as error:
        lines.append(f"not a zip: {error}; start={data[:300]!r}")
    return lines


def main():
    zip_path, mode = sys.argv[1], sys.argv[2]
    with open(zip_path, "rb") as handle:
        data = handle.read()
    try:
        run(data, mode)
    except Exception:  # Report the failure where it can be read without logs.
        import traceback
        annotate("error", "extract_brd failed", traceback.format_exc().splitlines()[-12:])
        annotate("notice", "Archive diagnostics", describe_archive(data))
        sys.exit(1)


def run(data, mode):
    found = find_brd(data)
    if not found:
        annotate("error", "No .brd file in archive", describe_archive(data))
        sys.exit(1)
    brd_name, brd_bytes, listing = found
    data = extract(brd_bytes)
    data["source"] = brd_name

    if mode == "summary":
        bbox = data["bbox"]
        width = bbox["maxX"] - bbox["minX"]
        height = bbox["maxY"] - bbox["minY"]
        annotate("notice", "Board outline", [
            f"file={brd_name}",
            f"bbox=({bbox['minX']:.3f},{bbox['minY']:.3f})-({bbox['maxX']:.3f},{bbox['maxY']:.3f}) mm",
            f"size={width:.3f} x {height:.3f} mm ({width / 25.4:.3f} x {height / 25.4:.3f} in)",
            f"archive entries: {', '.join(listing)[:1500]}",
        ])
        rows = [
            f"{e['name']}|{e['value'] or ''}|{e['package']}|{e['x']:.2f},{e['y']:.2f}|{e['rot']}"
            for e in sorted(data["elements"], key=lambda e: e["name"])
        ]
        annotate("notice", "Parts name|value|package|x y|rot", rows)
    elif mode == "headers":
        rows = []
        for e in sorted(data["elements"], key=lambda e: e["name"]):
            if not INTERESTING.match(e["name"] or ""):
                continue
            if e["name"].upper().startswith(("J", "SW", "S", "D", "LED", "USB", "CON", "P")) or e["name"] in ("R9", "R10"):
                pads = " ".join(f"{p['name']}@{p['x']:.2f},{p['y']:.2f}" for p in sorted(
                    e["pads"], key=lambda p: (len(p["name"]), p["name"])))
                rows.append(f"{e['name']} [{e['package']}] {e['rot']}: {pads}")
        annotate("notice", "Pads", rows)
    else:
        json.dump(data, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
