// Which way a directional glyph (strokes, hatching) should point in each cell, so the marks
// read as drawn contours instead of noise: they run ALONG the iso-line of the field, i.e.
// perpendicular to its gradient, the way pen strokes follow a ridge on a topographic map.
// Pure math on typed arrays only — no DOM — so render.js can import this at module scope
// and stay importable from plain Node.

const EPS = 1e-3; // gradient magnitude below this reads as "flat": use the hash fallback

export function cellHash(x, y) {
  return ((x * 73856093) ^ (y * 19349663)) >>> 0;
}

/**
 * Fills `out` (Uint8Array, length cols*rows) with an orientation per cell: 0 = h, 1 = v,
 * 2 = d1 (rising diagonal /), 3 = d2 (falling diagonal \). `aspect` is cell height / cell
 * width, used to scale the row-to-row difference so the angle is correct in screen space
 * (a tall cell makes the same field change over one row a steeper screen-space slope than
 * over one column). Flat cells (gradient below EPS) fall back to a hash of (x, y) so they
 * hold a stable, non-flickering orientation frame to frame instead of chasing noise.
 */
export function orientations(field, cols, rows, aspect, out) {
  for (let y = 0; y < rows; y++) {
    const y0 = y > 0 ? y - 1 : y;
    const y1 = y < rows - 1 ? y + 1 : y;
    const dyCells = y1 - y0;
    const rowBase = y * cols;
    for (let x = 0; x < cols; x++) {
      const x0 = x > 0 ? x - 1 : x;
      const x1 = x < cols - 1 ? x + 1 : x;
      const dxCells = x1 - x0;
      const gx = dxCells > 0 ? (field[rowBase + x1] - field[rowBase + x0]) / dxCells : 0;
      const gyRaw = dyCells > 0 ? (field[y1 * cols + x] - field[y0 * cols + x]) / dyCells : 0;
      const gy = gyRaw / aspect; // screen-space correction: see module comment
      const i = rowBase + x;
      if (gx * gx + gy * gy < EPS * EPS) {
        out[i] = cellHash(x, y) & 3;
        continue;
      }
      // Tangent to the gradient (rotate 90°): the direction the iso-line actually runs.
      const tx = -gy, ty = gx;
      let angle = Math.atan2(ty, tx);
      if (angle < 0) angle += Math.PI; // a line's direction is undirected: fold to [0, PI)
      if (angle < Math.PI / 8 || angle >= (7 * Math.PI) / 8) out[i] = 0; // h
      else if (angle < (3 * Math.PI) / 8) out[i] = 3; // d2, falling \
      else if (angle < (5 * Math.PI) / 8) out[i] = 1; // v
      else out[i] = 2; // d1, rising /
    }
  }
}
