// Writes db/pipelines/rentalComparables.mongosh.js: the exact pipeline the engine runs, for one sample input.
//   node db/scripts/printComparablePipeline.js
import { mkdirSync, writeFileSync } from "node:fs";
import { buildComparablePipeline } from "../tools/comparables.js";
import { toMongosh } from "../lib/mongosh.js";

export const SAMPLE = {
  pt: { type: "Point", coordinates: [-6.2551, 53.3264] },
  bedrooms: 2, types: ["apartment", "studio"], targetType: "apartment", monthlyRent: 2350, floorArea: 68,
  analysisDate: new Date("2026-10-03T12:00:00Z"), radiusM: 1000, windowDays: 90,
  geo: { saId: "sa:268001001", edIds: ["sa:268001001", "sa:268001002"], leaIds: ["sa:268001001", "sa:268001002", "sa:268001003"] },
};

export const sampleScript = () => `// Comparable-rental search, step 1 of the widening ladder (1000 m, 90 days). Generated; do not edit by hand.
// Run in mongosh against the rentcheck database:  load("rentalComparables.mongosh.js")
db.rental_observations.aggregate(${toMongosh(buildComparablePipeline(SAMPLE))})
`;

if (process.argv[1]?.endsWith("printComparablePipeline.js")) {
  mkdirSync(new URL("../pipelines/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../pipelines/rentalComparables.mongosh.js", import.meta.url), sampleScript());
  console.log("wrote db/pipelines/rentalComparables.mongosh.js");
}
