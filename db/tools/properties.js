// properties: one document per physical address, created on first analysis (get-or-create by addressKey).
// Stores only what is stable: the address, a located point, and the geography ids resolved once.
// Everything else (distances, counts, rent statistics) is derived per analysis and lives in analyses.
import { point } from "../lib/geo.js";

/** Lowercase, strip punctuation and accents, collapse spaces: "12 Example Rd., Ranelagh" -> "12 example rd ranelagh" */
export function addressKey(address, eircode) {
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const key = norm(address);
  return eircode ? `${key}|${norm(eircode).replace(/\s/g, "")}` : key;
}

export async function getOrCreateProperty(db, input, { geoMethod = "geocoder", geoConfidence } = {}) {
  const { address, eircode, latitude, longitude, bedrooms, propertyType, floorArea } = input;
  if (!address || typeof address !== "string") throw new TypeError("address is required");
  const geo = point(Number(longitude), Number(latitude));
  const key = addressKey(address, eircode);

  // Resolve geography once and cache the ids. Names and polygons are NOT copied; they stay in `areas`.
  const sa = await db.collection("areas").findOne(
    { level: "small_area", geometry: { $geoIntersects: { $geometry: geo } } }, { projection: { parents: 1 } });

  const now = new Date();
  const attributes = Object.fromEntries(Object.entries({ bedrooms, propertyType, floorAreaM2: floorArea }).filter(([, v]) => v != null));
  const res = await db.collection("properties").findOneAndUpdate(
    { addressKey: key },
    {
      $setOnInsert: {
        addressKey: key, address: { line: address, ...(eircode && { eircode }) }, geo, geoMethod,
        ...(geoConfidence != null && { geoConfidence }), origin: "user_input", createdAt: now,
        ...(sa && { areaId: sa._id, parents: sa.parents }),
      },
      $set: { updatedAt: now, ...(Object.keys(attributes).length && { attributes }) },
    },
    { upsert: true, returnDocument: "after" },
  );
  return res;
}

/** input = { address, latitude, longitude, monthlyRent, bedrooms, propertyType, floorArea, analysisDate, eircode? } */
export async function startAnalysis(db, input, geocode = {}, { dataPolicy } = {}) {
  const property = await getOrCreateProperty(db, input, geocode);
  const { createAnalysis } = await import("./index.js");
  const analysisId = await createAnalysis(db, { propertyId: property._id, input, dataPolicy });
  return { analysisId, propertyId: property._id, property };
}
