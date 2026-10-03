// Generates db/pipelines/rentTrend.mongosh.js: the seven trend recipes as runnable mongosh, from the same builder the tool uses.
//   node db/scripts/printTrendPipelines.js
import { mkdirSync, writeFileSync } from "node:fs";
import { buildTrendPipeline, startOfPeriod, addPeriods } from "../tools/trends.js";
import { toMongosh } from "../lib/mongosh.js";
import { TREND_V1 } from "../config/trendConfig.js";

const CENTER = { type: "Point", coordinates: [-6.2551, 53.3264] };
const LEA = { type: "lea", id: "lea:dublin-city-south-east" };

const base = (now, unit = "month", periods = 24) => {
  const to = startOfPeriod(now, unit), reportFrom = addPeriods(to, unit, -periods);
  return { measure: "advertised", pool: false, unit, analysisDate: now, to, reportFrom, from: addPeriods(reportFrom, unit, -TREND_V1.units[unit].lag) };
};
const mapMonths = (fields) => [{ $project: { _id: 0, series: "$_id", months: { $map: { input: "$points", in: fields } } } }];

export const recipes = (now) => [
  { name: "1. Monthly median rent", params: { ...base(now), scope: LEA, bedrooms: 2, propertyType: "apartment", sourceId: "listings" },
    post: mapMonths({ month: "$$this.label", n: "$$this.n", medianRent: "$$this.medianRent" }) },
  { name: "2. Monthly average rent", params: { ...base(now), scope: LEA, bedrooms: 2, propertyType: "apartment", sourceId: "listings" },
    post: mapMonths({ month: "$$this.label", n: "$$this.n", avgRent: "$$this.avgRent" }) },
  { name: "3. Year-on-year rent growth", params: { ...base(now), scope: LEA, bedrooms: 2, propertyType: "apartment", sourceId: "listings" },
    post: [{ $project: { _id: 0, series: "$_id", latestYoYMedianPct: 1, direction: 1,
      months: { $filter: { input: { $map: { input: "$points", in: { month: "$$this.label", medianRent: "$$this.medianRent", yoyMedianPct: "$$this.yoyMedianPct", yoyAvgPct: "$$this.yoyAvgPct" } } }, cond: { $ne: ["$$this.yoyMedianPct", null] } } } } }] },
  { name: "4. Trend around a specific property (1 km)", params: { ...base(now), scope: { type: "radius", center: CENTER, radiusM: 1000 }, bedrooms: 2, propertyType: "apartment", sourceId: "listings" },
    post: [{ $project: { _id: 0, series: "$_id", records: 1, sufficientPeriods: 1, latestMedian: 1, latestYoYMedianPct: 1, direction: 1, provenance: { observedFrom: "$observedFrom", observedTo: "$observedTo", sourceIds: "$sourceIds", versions: "$versions", retrievedAt: "$retrievedAt" } } }] },
  { name: "5. Trend within a geographic area (one census small area)", params: { ...base(now), scope: { type: "small_area", id: "sa:268001001" }, bedrooms: 2, propertyType: "apartment", sourceId: "listings" },
    post: [{ $project: { _id: 0, series: "$_id", records: 1, latestMedian: 1, totalChangeMedianPct: 1, latestYoYMedianPct: 1 } }] },
  { name: "6. Trend for a specific bedroom count (1-bed, every type and source, never pooled)", params: { ...base(now), scope: LEA, bedrooms: 1 },
    post: [{ $project: { _id: 0, series: "$_id", records: 1, latestMedian: 1, latestYoYMedianPct: 1, direction: 1 } }] },
  { name: "7. Trend for a property type (houses, every bedroom count and source)", params: { ...base(now), scope: LEA, propertyType: "house" },
    post: [{ $project: { _id: 0, series: "$_id", records: 1, latestMedian: 1, latestYoYMedianPct: 1, direction: 1 } }] },
];

export const toScript = (rc) =>
  `// ${rc.name}\ndb.rental_observation_series.aggregate(${toMongosh([...buildTrendPipeline(rc.params), ...rc.post])})\n`;

if (process.argv[1]?.endsWith("printTrendPipelines.js")) {
  const now = new Date("2026-10-03T12:00:00Z");
  const header = "// Rent-trend recipes against the time-series collection rental_observation_series. Generated; do not edit by hand.\n// Run each block in mongosh against the rentcheck database.\n\n";
  mkdirSync(new URL("../pipelines/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../pipelines/rentTrend.mongosh.js", import.meta.url), header + recipes(now).map(toScript).join("\n"));
  console.log("wrote db/pipelines/rentTrend.mongosh.js");
}
