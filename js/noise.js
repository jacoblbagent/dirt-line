// Tiny deterministic value-noise / FBM used for the procedural world.
function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 100000) / 100000;
}

function smooth(t) { return t * t * (3 - 2 * t); }

export function value2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

export function fbm(x, y, seed, octaves = 4, lac = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * value2(x * freq, y * freq, seed + i * 977);
    norm += amp;
    amp *= gain; freq *= lac;
  }
  return sum / norm;
}

export function ridged(x, y, seed, octaves = 3) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * (1 - Math.abs(value2(x * freq, y * freq, seed + i * 311) * 2 - 1));
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

// Cheap 1-D hash for per-cell jitter.
export function rnd(i, seed) { return hash2(i, seed * 7919, seed + 13); }
