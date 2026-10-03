// Resolving a point to its RTB rent area and choosing which official rent measure to read.
import { point } from "./geo.js";

/** Preference order when a zone has more than one official area-level measure. */
export const INDEX_MEASURES = ["index_mean", "registered_average"];

export const INDEX_MEASURE_LABEL = {
  index_mean: "RTB standardised rent index",
  registered_average: "RTB average registered rent (new tenancies)",
};

/**
 * Point -> rent area id.
 *  1. via the census small area's `parents.rtb_zone` (exact, when small areas are loaded)
 *  2. else the NEAREST rent PLACE (town / neighbourhood) that has a recent figure for the requested bedrooms/type
 *     (real RIQ02 data: places are geocoded centroids and most cells are suppressed, so "nearest" means "nearest with data")
 *  3. else, only if no place is in reach, the nearest COUNTY, flagged as a county-wide average.
 * Places and counties are different geographic levels and are never mixed. `distM` and `skippedNearer` let the caller be
 * honest about how approximate the match is.
 */
export async function resolveRtbZone(db, pt, { propertyType, bedrooms, maxDistanceM = 30000, countyMaxDistanceM = 90000, recentQuarters = 8 } = {}) {
  const sa = await db.collection("areas").findOne(
    { level: "small_area", geometry: { $geoIntersects: { $geometry: pt } } }, { projection: { parents: 1, name: 1 } });
  if (sa?.parents?.rtb_zone) return { zoneId: sa.parents.rtb_zone, level: "rtb_zone", method: "small_area_parent", smallArea: sa };

  const cutoff = new Date(); cutoff.setUTCMonth(cutoff.getUTCMonth() - recentQuarters * 3);
  const nearestWithData = async (level, maxDistance) => {
    const rows = await db.collection("areas").aggregate([
      { $geoNear: { near: pt, key: "centroid", distanceField: "distM", maxDistance, spherical: true, query: { level, "src.sourceId": { $exists: true } } } },
      { $limit: 25 },
      { $lookup: { from: "rental_indexes", let: { id: "$_id" }, as: "cell", pipeline: [
        { $match: { $expr: { $eq: ["$areaId", "$$id"] }, measure: { $in: INDEX_MEASURES }, ...(propertyType && { propertyType }), ...(bedrooms !== undefined && { bedrooms }), periodStart: { $gte: cutoff } } },
        { $sort: { periodStart: -1 } }, { $limit: 1 }, { $project: { periodLabel: 1, measure: 1 } }] } },
      { $project: { name: 1, geoMethod: 1, distM: { $round: ["$distM", 0] }, cell: { $first: "$cell" } } },
    ]).toArray();
    const i = rows.findIndex((r) => r.cell);
    return { rows, i };
  };
  const found = (level, { rows, i }, extra = {}) => {
    const z = rows[i];
    return { zoneId: z._id, zoneName: z.name, level, method: "nearest_with_data", distM: z.distM, skippedNearer: rows.slice(0, i).map((r) => ({ name: r.name, distM: r.distM })),
      latestPeriod: z.cell.periodLabel, measure: z.cell.measure, approximate: true, smallArea: sa ?? null, ...extra };
  };

  const places = await nearestWithData("rtb_zone", maxDistanceM);
  if (places.i >= 0) return found("rtb_zone", places);
  const counties = await nearestWithData("county", countyMaxDistanceM);
  if (counties.i >= 0) return found("county", counties, { countyFallback: true, placesWithoutData: places.rows.length });
  return { zoneId: null, level: null, method: "none", smallArea: sa ?? null, nearestM: places.rows[0]?.distM ?? null };
}

/** The first measure (in preference order) that has data for this zone/type/bedrooms. */
export async function pickIndexMeasure(db, { areaId, propertyType, bedrooms }) {
  for (const measure of INDEX_MEASURES) {
    if (await db.collection("rental_indexes").findOne({ areaId, measure, propertyType, bedrooms }, { projection: { _id: 1 } })) return measure;
  }
  return null;
}
