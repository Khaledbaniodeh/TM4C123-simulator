/*
 * Workspace geometry: one world coordinate system shared by parts, pins,
 * and wires. World units are CSS pixels at 96 dpi, so 0.1 in = 9.6 units
 * and the 0.1-inch header pitch falls exactly on the snap grid.
 *
 * Pure functions only — no DOM access — so they are unit-tested in Node.
 */

export const PX_PER_MM = 96 / 25.4;
export const PX_PER_INCH = 96;
/** Snap grid: 0.1 inch, the pitch of the LaunchPad headers. */
export const GRID = PX_PER_INCH / 10;

export function mm(value) {
  return value * PX_PER_MM;
}

export function snap(value, grid = GRID) {
  return Math.round(value / grid) * grid;
}

export function snapPoint(point, grid = GRID) {
  return { x: snap(point.x, grid), y: snap(point.y, grid) };
}

/** Normalizes an angle to 0, 90, 180, or 270 degrees. */
export function normalizeRotation(degrees) {
  const quarter = Math.round(Number(degrees || 0) / 90);
  return (((quarter % 4) + 4) % 4) * 90;
}

/** Rotates a point about (cx, cy) by a multiple of 90 degrees (exact, no float drift). */
export function rotateQuarter(point, degrees, cx = 0, cy = 0) {
  const dx = point.x - cx;
  const dy = point.y - cy;
  switch (normalizeRotation(degrees)) {
  case 90: return { x: cx - dy, y: cy + dx };
  case 180: return { x: cx - dx, y: cy - dy };
  case 270: return { x: cx + dy, y: cy - dx };
  default: return { x: cx + dx, y: cy + dy };
  }
}

/**
 * Maps a point in a part's local coordinates to world coordinates.
 * Parts rotate about their own center (like Wokwi), then translate by
 * (left, top).
 */
export function partToWorld(local, part, size) {
  const center = { x: size.width / 2, y: size.height / 2 };
  const rotated = rotateQuarter(local, part.rotate ?? 0, center.x, center.y);
  return { x: (part.left ?? 0) + rotated.x, y: (part.top ?? 0) + rotated.y };
}

/** Axis-aligned world bounds of a (possibly rotated) part. */
export function partBounds(part, size) {
  const corners = [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: 0, y: size.height },
    { x: size.width, y: size.height },
  ].map((corner) => partToWorld(corner, part, size));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** SVG `transform` attribute equivalent of partToWorld. */
export function partTransform(part, size) {
  const rotation = normalizeRotation(part.rotate);
  const translate = `translate(${round(part.left ?? 0)} ${round(part.top ?? 0)})`;
  return rotation
    ? `${translate} rotate(${rotation} ${round(size.width / 2)} ${round(size.height / 2)})`
    : translate;
}

export function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * Parses Wokwi-style routing instructions ("v10", "h-5"). Returns null for
 * anything invalid.
 */
export function parseInstruction(instruction) {
  const match = /^([vh])(-?\d+(?:\.\d+)?)$/.exec(String(instruction));
  return match ? { axis: match[1], delta: Number(match[2]) } : null;
}

/**
 * Builds an orthogonal polyline between two world points.
 * `routing` follows the diagram.json mini-language: instructions before "*"
 * apply from the source pin, instructions after "*" apply (in reverse) from
 * the target pin, and the remaining gap is closed with one horizontal and
 * one vertical segment. Wires never run diagonally.
 */
export function routeWire(from, to, routing = []) {
  const star = routing.indexOf("*");
  const sourceSteps = (star >= 0 ? routing.slice(0, star) : routing).map(parseInstruction).filter(Boolean);
  const targetSteps = (star >= 0 ? routing.slice(star + 1) : []).map(parseInstruction).filter(Boolean);

  const head = [{ ...from }];
  for (const step of sourceSteps) {
    const last = head.at(-1);
    head.push(step.axis === "v" ? { x: last.x, y: last.y + step.delta } : { x: last.x + step.delta, y: last.y });
  }

  const tail = [{ ...to }];
  for (const step of [...targetSteps].reverse()) {
    const last = tail.at(-1);
    tail.push(step.axis === "v" ? { x: last.x, y: last.y + step.delta } : { x: last.x + step.delta, y: last.y });
  }
  tail.reverse();

  const a = head.at(-1);
  const b = tail[0];
  const middle = [];
  if (a.x !== b.x && a.y !== b.y) {
    // Leave the source in the direction of its last explicit segment when
    // known, otherwise horizontally first.
    const lastSource = sourceSteps.at(-1);
    middle.push(lastSource?.axis === "v" ? { x: a.x, y: b.y } : { x: b.x, y: a.y });
  }
  return simplify([...head, ...middle, ...tail]);
}

/** Removes duplicate and collinear interior points. */
export function simplify(points) {
  const result = [];
  for (const point of points) {
    const last = result.at(-1);
    if (last && last.x === point.x && last.y === point.y) {
      continue;
    }
    result.push(point);
    while (result.length >= 3) {
      const [p, q, r] = result.slice(-3);
      const collinear = (p.x === q.x && q.x === r.x) || (p.y === q.y && q.y === r.y);
      if (!collinear) {
        break;
      }
      result.splice(result.length - 2, 1);
    }
  }
  return result;
}

export function pathData(points) {
  return points.map((p, i) => `${i ? "L" : "M"}${round(p.x)} ${round(p.y)}`).join(" ");
}

/** Converts a polyline (from routeWire with no routing) back to instructions from the source side. */
export function pointsToRouting(points) {
  const routing = [];
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.x === b.x && a.y !== b.y) {
      routing.push(`v${round(b.y - a.y)}`);
    } else if (a.y === b.y && a.x !== b.x) {
      routing.push(`h${round(b.x - a.x)}`);
    }
  }
  return routing;
}

/**
 * Makes any segment of a routed wire draggable without moving its pins.
 * Dragging moves both ends of the chosen segment perpendicular to it, which
 * is only possible for inner segments; for a segment that touches a pin, a
 * zero-length stub is inserted at that pin first, so the drag grows a short
 * perpendicular jog there instead. Returns { points, segment } (a new list;
 * the dragged segment is points[segment] → points[segment + 1]), or null for
 * an invalid segment index.
 */
export function editableSegment(points, segment) {
  if (!Number.isInteger(segment) || segment < 0 || segment >= points.length - 1) {
    return null;
  }
  let expanded = points.map((point) => ({ ...point }));
  let index = segment;
  if (index === 0) {
    expanded = [expanded[0], { ...expanded[0] }, ...expanded.slice(1)];
    index = 1;
  }
  if (index === expanded.length - 2) {
    expanded = [...expanded, { ...expanded.at(-1) }];
  }
  return { points: expanded, segment: index };
}

/**
 * Where to put pasted or duplicated items so they are visible without
 * changing the view (smart paste).
 *
 * `bounds` is the world bounding box of the items at their source position,
 * `view` the visible world rectangle, `preferred` the offset the editor would
 * use by default (e.g. a 0.3 in cascade). If the items fit inside the view
 * (minus `margin`) at the preferred offset and that spot is not in `avoid`,
 * the preferred offset is kept. Otherwise the first free spot is searched in
 * rings of `step` around the middle of the view (down-right first); when the
 * items are larger than the view they are aligned to its top-left corner.
 * Offsets are multiples of `grid`, so parts keep their grid alignment and
 * relative positions. `avoid` holds placementKey()s already used, so repeated
 * pastes never stack exactly while there is room.
 *
 * Returns { dx, dy, relocated }.
 */
export function placeInView(bounds, view, preferred, { margin = GRID * 2, grid = GRID, step = GRID * 3, avoid = new Set() } = {}) {
  const inner = {
    x: view.x + margin,
    y: view.y + margin,
    width: Math.max(0, view.width - 2 * margin),
    height: Math.max(0, view.height - 2 * margin),
  };
  const fits = (dx, dy) =>
    bounds.x + dx >= inner.x - 1e-6 && bounds.y + dy >= inner.y - 1e-6
    && bounds.x + dx + bounds.width <= inner.x + inner.width + 1e-6
    && bounds.y + dy + bounds.height <= inner.y + inner.height + 1e-6;
  const free = (dx, dy) => fits(dx, dy) && !avoid.has(placementKey(bounds, dx, dy));
  if (free(preferred.dx, preferred.dy)) {
    return { dx: preferred.dx, dy: preferred.dy, relocated: false };
  }
  const x = bounds.width <= inner.width ? view.x + (view.width - bounds.width) / 2 : inner.x;
  const y = bounds.height <= inner.height ? view.y + (view.height - bounds.height) / 2 : inner.y;
  const center = { dx: snap(x - bounds.x, grid), dy: snap(y - bounds.y, grid) };
  const rings = Math.ceil(Math.max(view.width, view.height) / step);
  for (let ring = 0; ring <= rings; ring++) {
    const offsets = [];
    for (let ix = -ring; ix <= ring; ix++) {
      for (let iy = -ring; iy <= ring; iy++) {
        if (Math.max(Math.abs(ix), Math.abs(iy)) === ring) {
          offsets.push([ix, iy]);
        }
      }
    }
    // Down-right diagonal first (the familiar cascade direction), then the rest in a fixed order.
    offsets.sort((a, b) => Number(!(a[0] === a[1] && a[0] > 0)) - Number(!(b[0] === b[1] && b[0] > 0)) || a[1] - b[1] || a[0] - b[0]);
    for (const [ix, iy] of offsets) {
      const dx = center.dx + ix * step;
      const dy = center.dy + iy * step;
      if (free(dx, dy)) {
        return { dx, dy, relocated: true };
      }
    }
  }
  return { ...center, relocated: true }; // no free spot: the middle of the view
}

/** Key of the position of `bounds` moved by (dx, dy), for placeInView's `avoid`. */
export function placementKey(bounds, dx, dy) {
  return `${(bounds.x + dx).toFixed(3)},${(bounds.y + dy).toFixed(3)}`;
}

// ---------------------------------------------------------------------------
// Viewport (SVG viewBox) math
// ---------------------------------------------------------------------------

/** Converts client (screen) coordinates to world coordinates for a viewBox shown in `rect`. */
export function clientToWorld(viewBox, rect, clientX, clientY) {
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  // preserveAspectRatio="xMidYMid meet": content is centered in the element.
  const offsetX = (rect.width - viewBox.width * scale) / 2;
  const offsetY = (rect.height - viewBox.height * scale) / 2;
  return {
    x: viewBox.x + (clientX - rect.left - offsetX) / scale,
    y: viewBox.y + (clientY - rect.top - offsetY) / scale,
  };
}

/** Zooms a viewBox by `factor` (> 1 zooms in) keeping `anchor` (world) fixed on screen. */
export function zoomViewBox(viewBox, factor, anchor, limits = { minWidth: 60, maxWidth: 20_000 }) {
  const width = clamp(viewBox.width / factor, limits.minWidth, limits.maxWidth);
  const applied = viewBox.width / width;
  const height = viewBox.height / applied;
  return {
    x: anchor.x - (anchor.x - viewBox.x) / applied,
    y: anchor.y - (anchor.y - viewBox.y) / applied,
    width,
    height,
  };
}

export function panViewBox(viewBox, dxWorld, dyWorld) {
  return { ...viewBox, x: viewBox.x - dxWorld, y: viewBox.y - dyWorld };
}

/** Smallest viewBox with the element's aspect ratio that contains `bounds` plus `margin`. */
export function fitViewBox(bounds, aspect, margin = 40) {
  let width = bounds.width + margin * 2;
  let height = bounds.height + margin * 2;
  if (width / height < aspect) {
    width = height * aspect;
  } else {
    height = width / aspect;
  }
  return {
    x: bounds.x + bounds.width / 2 - width / 2,
    y: bounds.y + bounds.height / 2 - height / 2,
    width,
    height,
  };
}

export function unionBounds(list) {
  if (!list.length) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const minX = Math.min(...list.map((b) => b.x));
  const minY = Math.min(...list.map((b) => b.y));
  const maxX = Math.max(...list.map((b) => b.x + b.width));
  const maxY = Math.max(...list.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
