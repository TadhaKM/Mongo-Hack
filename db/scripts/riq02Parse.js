// Parser for the CSO PxStat RIQ02 JSON-stat 2.0 cube ("RTB Average Monthly Rent Report").
//   https://ws.cso.ie/public/api.restful/PxStat.Data.Cube_API.ReadDataset/RIQ02/JSON-stat/2.0/en
// Dimensions: quarter x bedrooms x property type x location (446). Values are monthly averages in EUR, 83% null in the latest quarter.

const BEDROOMS = { "-": { all: true }, "01": { bedrooms: 1 }, "02": { bedrooms: 2 }, "03": { bedrooms: 3 }, "08": { bedrooms: 4, label: "4+" },
  "06": { skip: "range (1 to 2 bed)" }, "07": { skip: "range (1 to 3 bed)" } };
const TYPES = { "-": "all", "01": "detached", "02": "semi_detached", "03": "terraced", "04": "apartment", "05": "other_flat" };

const catKeys = (dim) => (Array.isArray(dim.category.index) ? dim.category.index : Object.keys(dim.category.index));

/** quarter code "20254" -> { label: "2025Q4", start: Date(2025-10-01), year, quarter } */
export function quarterOf(code, label) {
  const year = +code.slice(0, 4), quarter = +code.slice(4);
  return { label: label ?? `${year}Q${quarter}`, year, quarter, start: new Date(Date.UTC(year, (quarter - 1) * 3, 1)) };
}

export function parseRiq02(cube) {
  const [, tId, bId, pId, lId] = cube.id;
  const dim = (k) => cube.dimension[k];
  const T = catKeys(dim(tId)), B = catKeys(dim(bId)), P = catKeys(dim(pId)), L = catKeys(dim(lId));
  const tl = dim(tId).category.label, ll = dim(lId).category.label;
  const quarters = T.map((c) => quarterOf(c, tl[c]));
  const locations = L.map((c) => ({ code: c, label: ll[c] }));
  const values = cube.value;
  const at = (t, b, p, l) => values[((t * B.length + b) * P.length + p) * L.length + l];

  const recent = Math.max(0, T.length - 12);
  const hasRecentData = new Set();
  const cells = [];   // non-null cells
  const skipped = { range: 0 };
  for (let t = 0; t < T.length; t++) for (let b = 0; b < B.length; b++) for (let p = 0; p < P.length; p++) for (let l = 0; l < L.length; l++) {
    const v = at(t, b, p, l);
    if (v == null) continue;
    const bed = BEDROOMS[B[b]]; if (!bed) continue;
    if (bed.skip) { skipped.range++; continue; }
    if (t >= recent) hasRecentData.add(L[l]);
    cells.push({ quarter: quarters[t], bedrooms: bed.all ? undefined : bed.bedrooms, bedroomLabel: bed.label, propertyType: TYPES[P[p]], location: locations[l], avgRent: v });
  }
  return {
    cells, locations, quarters, hasRecentData, skipped,
    meta: { id: cube.extension?.matrix ?? "RIQ02", updated: cube.updated, label: cube.label, href: cube.link?.alternate?.find((a) => a.type === "application/json")?.href, copyright: cube.extension?.copyright },
  };
}
