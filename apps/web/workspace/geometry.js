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

/** A route closer than this to a pin centre is drawn over its pad (pins are 0.1 in apart). */
export const PAD_CLEARANCE = GRID * 0.45;

/**
 * Direction (a unit vector in world axes) a wire should leave or enter a pin:
 * the pin's own `escape` (the board's header columns), otherwise outward from
 * the part edge the pin sits on, turned with the part. null for a pin inside
 * the part outline.
 */
export function pinEscape(pin, part, size) {
  const edge = 1e-6;
  let local = pin.escape ?? null;
  if (!local) {
    if (pin.x <= edge) {
      local = { x: -1, y: 0 };
    } else if (pin.x >= size.width - edge) {
      local = { x: 1, y: 0 };
    } else if (pin.y <= edge) {
      local = { x: 0, y: -1 };
    } else if (pin.y >= size.height - edge) {
      local = { x: 0, y: 1 };
    }
  }
  if (!local) {
    return null;
  }
  const turned = rotateQuarter(local, part.rotate ?? 0);
  return { x: Math.round(turned.x) || 0, y: Math.round(turned.y) || 0 };
}

/**
 * Routing instructions that make routeWire() draw a simplified orthogonal
 * polyline: every segment from the source as a step, except the last two,
 * which the closing L draws to the exact target. A zero-length step ("v0" or
 * "h0") sets the axis the closing L starts on, so no rounding of a step can
 * add a jog at the target. [] for a straight wire or the default L.
 */
export function routingFor(points) {
  if (points.length <= 2) {
    return [];
  }
  const routing = [];
  for (let i = 1; i < points.length - 2; i++) {
    const a = points[i - 1];
    const b = points[i];
    routing.push(a.x === b.x ? `v${round(b.y - a.y)}` : `h${round(b.x - a.x)}`);
  }
  const closing = points.at(-3).x === points.at(-2).x ? "v" : "h";
  if (closing !== (routing.at(-1)?.[0] ?? "h")) {
    routing.push(`${closing}0`);
  }
  return routing;
}

function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  }
  return round(length);
}

/** Pads (pin centres) that a polyline passes over; counting stops once it exceeds `limit`. */
export function padCrossings(points, pads, clearance = PAD_CLEARANCE, limit = Infinity) {
  const reach = clearance * clearance;
  let count = 0;
  for (const pad of pads) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dx = Math.max(Math.min(a.x, b.x) - pad.x, 0, pad.x - Math.max(a.x, b.x));
      const dy = Math.max(Math.min(a.y, b.y) - pad.y, 0, pad.y - Math.max(a.y, b.y));
      if (dx * dx + dy * dy < reach) {
        if (++count > limit) {
          return count;
        }
        break;
      }
    }
  }
  return count;
}

/** Horizontal and vertical segments of wire polylines, as { at, lo, hi } (y or x, then the span). */
function wireSegments(wires) {
  const segments = { h: [], v: [] };
  for (const wire of wires) {
    for (let j = 1; j < wire.length; j++) {
      const c = wire[j - 1];
      const d = wire[j];
      if (c.y === d.y && c.x !== d.x) {
        segments.h.push({ at: c.y, lo: Math.min(c.x, d.x), hi: Math.max(c.x, d.x) });
      } else if (c.x === d.x && c.y !== d.y) {
        segments.v.push({ at: c.x, lo: Math.min(c.y, d.y), hi: Math.max(c.y, d.y) });
      }
    }
  }
  return segments;
}

function segmentOverlap(points, segments, clearance) {
  let overlap = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const vertical = a.x === b.x;
    const at = vertical ? a.x : a.y;
    const lo = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const hi = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    for (const segment of vertical ? segments.v : segments.h) {
      if (Math.abs(segment.at - at) < clearance) {
        overlap += Math.max(0, Math.min(hi, segment.hi) - Math.max(lo, segment.lo));
      }
    }
  }
  return round(overlap);
}

/** Length a polyline runs along (on top of, or too close to tell apart) other wires. */
export function wireOverlap(points, wires, clearance = PAD_CLEARANCE) {
  return segmentOverlap(points, wireSegments(wires), clearance);
}

/** Lane positions 1…count grid either side of two coordinates, nearest first, without repeats. */
function lanesAround(first, second, count, grid) {
  const lanes = new Map([[round(first), null], [round(second), null]]);
  for (let k = 1; k <= count; k++) {
    for (const lane of [first + k * grid, first - k * grid, second + k * grid, second - k * grid]) {
      if (!lanes.has(round(lane))) {
        lanes.set(round(lane), lane);
      }
    }
  }
  return [...lanes.values()].filter((lane) => lane !== null);
}

/**
 * Automatic route for a new wire (smart routing at creation time): routing
 * instructions plus the polyline routeWire() draws for them.
 *
 * Candidates leave each pin along its escape direction (a stub of 0, 1, or 2
 * grid) and join the stubs with an L, or with a detour through a horizontal
 * or vertical lane up to `lanes` grid from either stub. The winner crosses the
 * fewest unrelated pin pads, then passes through the fewest part bodies (a
 * wire over a part would also cover its controls, such as a button cap), then
 * runs along existing wires the least, then has the fewest bends, then is the
 * shortest; the default L (routing [], as in older diagrams) wins every tie.
 * The winner becomes instructions with routingFor(), and `points` is what
 * routeWire() draws for them, so the preview, the created wire, and the wire
 * after saving and reloading are the same polyline.
 *
 * Options:
 *   fromEscape, toEscape  unit vectors from pinEscape(), or null (a free end)
 *   pads    [{ x, y }] pin centres to keep clear of (not the wire's own pins)
 *   bodies  [{ x, y, width, height }] part outlines to keep out of (not the
 *           board, whose headers sit inside it); a band along each edge,
 *           where pins sit, does not count
 *   wires   [[{ x, y }, ...]] polylines of the existing wires
 *
 * Returns { routing, points, crossings, bodies, overlap }.
 */
export function autoRoute(from, to, { fromEscape = null, toEscape = null, pads = [], bodies = [], wires = [], grid = GRID, lanes = 12 } = {}) {
  const stubs = (point, escape) => (escape ? [0, 1, 2] : [0]).map((k) => (k ? { x: point.x + escape.x * k * grid, y: point.y + escape.y * k * grid } : point));
  const clearance = grid * 0.45;
  const inset = grid / 4;
  const candidates = [];
  const add = (inner) => {
    const points = simplify([from, ...inner, to]);
    candidates.push({ points, bends: Math.max(0, points.length - 2), length: pathLength(points), order: candidates.length });
  };
  for (const a of stubs(from, fromEscape)) {
    for (const b of stubs(to, toEscape)) {
      add([a, { x: b.x, y: a.y }, b]);
      add([a, { x: a.x, y: b.y }, b]);
      for (const y of lanesAround(a.y, b.y, lanes, grid)) {
        add([a, { x: a.x, y }, { x: b.x, y }, b]);
      }
      for (const x of lanesAround(a.x, b.x, lanes, grid)) {
        add([a, { x, y: a.y }, { x, y: b.y }, b]);
      }
    }
  }
  candidates.sort((p, q) => p.bends - q.bends || p.length - q.length || p.order - q.order);
  const segments = wireSegments(wires);
  let best = null;
  for (const candidate of candidates) {
    const crossings = padCrossings(candidate.points, pads, clearance, best?.crossings);
    if (best && crossings > best.crossings) {
      continue;
    }
    const through = bodyCrossings(candidate.points, bodies, inset);
    if (best && crossings === best.crossings && through > best.through) {
      continue;
    }
    const overlap = segmentOverlap(candidate.points, segments, clearance);
    if (!best || crossings < best.crossings || through < best.through || overlap < best.overlap) {
      best = { candidate, crossings, through, overlap };
      if (!crossings && !through && !overlap) {
        break;
      }
    }
  }
  const routing = routingFor(best.candidate.points);
  const points = routeWire(from, to, routing);
  return {
    routing,
    points,
    crossings: padCrossings(points, pads, clearance),
    bodies: bodyCrossings(points, bodies, inset),
    overlap: segmentOverlap(points, segments, clearance),
  };
}

/**
 * Part bodies ({ x, y, width, height }) a polyline passes through. A band
 * `inset` wide along each edge does not count, so a wire may reach a pin on
 * the edge (or run along the edge) without counting as crossing the part.
 */
export function bodyCrossings(points, bodies, inset = GRID / 4) {
  let count = 0;
  for (const body of bodies) {
    const left = body.x + inset;
    const right = body.x + body.width - inset;
    const top = body.y + inset;
    const bottom = body.y + body.height - inset;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom) {
        count++;
        break;
      }
    }
  }
  return count;
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
 * Where to put pasted or duplicated items so they are visible, preferably
 * on free canvas, without changing the view or moving existing parts
 * (smart, collision-aware placement).
 *
 * `bounds` is the world bounding box of the items at their source position,
 * `view` the visible world rectangle, `preferred` the offset the editor would
 * use by default (e.g. a 0.3 in cascade). Options:
 *   margin     keep this far inside the view edges
 *   grid       every offset is a multiple of it (grid alignment and relative
 *              positions are preserved)
 *   step       spacing of the search rings around the middle of the view
 *   avoid      placementKey()s already used, so placements never stack exactly
 *   obstacles  [{ x, y, width, height, family? }] occupied regions (existing
 *              parts, the board); `family` marks the source and earlier copies,
 *              which the familiar cascade may overlap
 *   clearance  minimum gap to an obstacle
 *   inPlace    keep `preferred` whenever it is visible (paste after cut)
 *
 * Order of preference:
 *   1. `preferred`, if visible, unused, and clear of non-family obstacles;
 *   2. the first visible, unused, collision-free spot in rings around the
 *      middle of the view (down-right first);
 *   3. crowded view: the visible, unused spot with the least overlap (the
 *      earliest in the same ring order on ties);
 *   4. nothing fits (items larger than the view): centered, or aligned to
 *      the view's top-left margin.
 * With no obstacles this is exactly the visibility-only placement.
 *
 * Returns { dx, dy, relocated, crowded }.
 */
export function placeInView(bounds, view, preferred, {
  margin = GRID * 2,
  grid = GRID,
  step = GRID * 3,
  avoid = new Set(),
  obstacles = [],
  clearance = GRID,
  inPlace = false,
} = {}) {
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
  const unused = (dx, dy) => !avoid.has(placementKey(bounds, dx, dy));
  const overlap = (dx, dy, includeFamily) => {
    let area = 0;
    for (const o of obstacles) {
      if (o.family && !includeFamily) {
        continue;
      }
      const w = Math.min(bounds.x + dx + bounds.width, o.x + o.width + clearance) - Math.max(bounds.x + dx, o.x - clearance);
      const h = Math.min(bounds.y + dy + bounds.height, o.y + o.height + clearance) - Math.max(bounds.y + dy, o.y - clearance);
      if (w > 1e-6 && h > 1e-6) {
        area += w * h;
      }
    }
    return area;
  };

  if (fits(preferred.dx, preferred.dy) && unused(preferred.dx, preferred.dy)
    && (inPlace || overlap(preferred.dx, preferred.dy, false) === 0)) {
    return { dx: preferred.dx, dy: preferred.dy, relocated: false, crowded: false };
  }

  const x = bounds.width <= inner.width ? view.x + (view.width - bounds.width) / 2 : inner.x;
  const y = bounds.height <= inner.height ? view.y + (view.height - bounds.height) / 2 : inner.y;
  const center = { dx: snap(x - bounds.x, grid), dy: snap(y - bounds.y, grid) };
  const rings = Math.ceil(Math.max(view.width, view.height) / step);
  let best = null;
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
      if (!fits(dx, dy) || !unused(dx, dy)) {
        continue;
      }
      const area = overlap(dx, dy, true);
      if (area === 0) {
        return { dx, dy, relocated: true, crowded: false };
      }
      if (!best || area < best.area - 1e-6) {
        best = { dx, dy, area };
      }
    }
  }
  if (best) {
    return { dx: best.dx, dy: best.dy, relocated: true, crowded: true };
  }
  return { ...center, relocated: true, crowded: true };
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
