// Global tuning constants for Dirt Jumps.
export const CFG = {
  GRID: 257,          // heightfield cells per side (257 -> 66k verts)
  CELL: 0.5,          // metres per cell (world = GRID*CELL = 128 m)
  WORLD: 128,
  HALF: 64,
  EYE: 1.83,          // 6 ft tall human
  BULK: 1.25,         // excavated soil bulks ~25% (loose litres vs in-situ)
  PLAYER_LOAD: 160,   // litres a person carries comfortably
  BARROW_MAX: 400,    // litres in a wheelbarrow
  DIG_RATE: 0.12,     // m of height removed / second at brush centre (÷ resistance)
  POUR_RATE: 62,      // litres / second poured at full hold
  TRICKLE: 0.22,      // multiplier when pouring with right mouse (fine feathering)
  SLUMP_MS: 5.0,      // per-frame slumping time budget
  LOOSE_TAN: 0.70,    // tan(35°) — angle of repose for loose spoil
  PACK_GAIN: 3.30,    // tan(66°) — packed faces hold far steeper
  TEX: 2048,          // surface paint canvas resolution
};

// Surface marking types (which tool left the mark).
export const MK = {
  NONE: 0,
  DIG: 1,      // spade scoop
  LOOSE: 2,    // freshly poured spoil
  FLAT: 3,     // flat-head pack — smooth, wide, preferred
  SPADE: 4,    // back-of-spade slap — ridged
  RAKE: 5,     // rake grooming grooves
  PICK: 6,     // pick axe pocks / broken ground
  SHAVE: 7,    // flat-head shaved plane
};

export const TOOL_IDS = ['spade', 'flathead', 'pickaxe', 'rake'];

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
