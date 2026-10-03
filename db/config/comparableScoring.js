// Comparable-scoring model "comp-v1". Change a number here and the pipeline, the docs table
// and the evidence context all follow, because the version string is stored with every result.
export const COMP_V1 = {
  version: "comp-v1",

  // Factor weights. Must sum to 100.
  weights: { distance: 30, recency: 20, floorArea: 15, type: 15, area: 10, quality: 10 },

  distance: { maxM: 4000 },               // score = max(0, 1 - d / maxM)
  recency: { halfLifeDays: 90 },          // score = 0.5 ^ (ageDays / halfLifeDays)
  floorArea: { maxRelDiff: 0.5, unknown: 0.5 },  // score = max(0, 1 - (|a-b|/b) / maxRelDiff); unknown = 0.5
  type: { sameType: 1, compatibleType: 0.5, unknown: 0.5 },
  area: { smallArea: 1, electoralDivision: 0.7, lea: 0.4, outside: 0 },
  quality: { unknownGeoConfidence: 0.5 }, // score = clamp(geoConfidence, 0, 1)

  // Hard filters: a listing failing any of these is never a comparable (scoring never rescues it).
  // bedrooms: exact match. propertyType: same compatibility group (below). measure: asking rents only.
  typeGroups: {
    flat: ["apartment", "studio"],
    house: ["house", "detached", "semi_detached", "terraced"],
  },

  // Selection
  minScore: 50,          // comparables scoring below this are excluded
  maxComparables: 40,    // strongest N kept
  historyMonths: 12,

  // Widening ladder for thin data. Stops at the first step with >= minComparables.
  minComparables: 8,
  ladder: [
    { radiusM: 1000, windowDays: 90 },
    { radiusM: 2000, windowDays: 180 },
    { radiusM: 3000, windowDays: 365 },
    { radiusM: 4000, windowDays: 365 },
  ],

  // Status / confidence by final comparable count n
  status: { none: 0, insufficientBelow: 3, limitedBelow: 8 },   // n=0 none, 1-2 insufficient, 3-7 limited, >=8 sufficient
  confidence: { highAt: 20, mediumAt: 8, lowAt: 3 },
};

const sum = Object.values(COMP_V1.weights).reduce((a, b) => a + b, 0);
if (sum !== 100) throw new Error(`comp-v1 weights must sum to 100, got ${sum}`);
