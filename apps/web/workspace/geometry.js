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
