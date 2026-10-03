// JSON-Schema validators. They exist mainly to make the dangerous mistakes impossible:
//  * a rental observation without a `measure`, or with a measure that is not rent-like
//  * an index cell or a sale price landing in the collection the comparable engine reads
// Applied with validationAction "error" so bad rows from the loader fail loudly instead of corrupting statistics.

const num = { bsonType: ["double", "int", "long", "decimal"] };
const posNum = { ...num, minimum: 0, exclusiveMinimum: true };
const str = { bsonType: "string" };
const date = { bsonType: "date" };
const point = {
  bsonType: "object", required: ["type", "coordinates"],
  properties: { type: { enum: ["Point"] }, coordinates: { bsonType: "array", minItems: 2, maxItems: 2, items: num } },
};
const src = {
  bsonType: "object", required: ["sourceId", "recordId", "version", "retrievedAt"],
  properties: { sourceId: str, recordId: str, version: str, retrievedAt: date,
    geoMethod: { enum: ["source_coords", "eircode", "address_match", "centroid", "polygon"] },
    geoConfidence: { ...num, minimum: 0, maximum: 1 } },
};
const propertyType = { enum: ["apartment", "house", "detached", "semi_detached", "terraced", "studio", "other_flat", "all", "unknown"] };

export const VALIDATORS = {
  // Individual advertised or registered rents. Point data only.
  rental_observations: {
    bsonType: "object",
    required: ["measure", "rent", "bedrooms", "propertyType", "geo", "areaId", "observedAt", "src"],
    additionalProperties: true,
    properties: {
      measure: { enum: ["advertised", "registered"] },
      rent: { bsonType: "object", required: ["amount", "period"], properties: { amount: posNum, period: { enum: ["month"] } } },
      bedrooms: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 5 },
      propertyType,
      floorAreaM2: posNum, geo: point, areaId: str, observedAt: date, address: str, propertyId: { bsonType: "objectId" },
      description: str, embedding: { bsonType: "array", items: num }, src,
    },
  },
  // Area-level official statistics. No point geometry, and a differently named value field on purpose.
  rental_indexes: {
    bsonType: "object",
    required: ["areaId", "areaLevel", "propertyType", "measure", "avgRent", "periodStart", "periodLabel", "src"],
    properties: {
      areaId: str, areaLevel: str, propertyType, bedrooms: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 5 },
      measure: { enum: ["index_mean", "registered_average"] },
      avgRent: posNum, stdError: num, sampleSize: num, periodStart: date, periodLabel: str, src,
    },
    not: { anyOf: [{ required: ["rent"] }, { required: ["geo"] }] },   // cannot be mistaken for an observation
  },
  // Sales: a price, never a rent.
  property_sales: {
    bsonType: "object",
    required: ["address", "salePrice", "saleDate", "fullMarketPrice", "src"],
    properties: { address: str, salePrice: posNum, saleDate: date, fullMarketPrice: { bsonType: "bool" }, geo: point, areaId: str, src },
    not: { anyOf: [{ required: ["rent"] }, { required: ["measure"] }, { required: ["avgRent"] }] },
  },
  properties: {
    bsonType: "object", required: ["addressKey", "address", "geo", "origin", "createdAt"],
    properties: { addressKey: str, address: { bsonType: "object", required: ["line"], properties: { line: str, eircode: str } }, geo: point,
      geoMethod: { enum: ["user_pin", "geocoder", "eircode", "address_match"] }, geoConfidence: { ...num, minimum: 0, maximum: 1 },
      areaId: str, origin: { enum: ["user_input", "listing", "register"] }, createdAt: date, updatedAt: date },
  },
  analyses: {
    bsonType: "object", required: ["propertyId", "input", "status", "createdAt", "evidence", "results"],
    properties: { propertyId: { bsonType: "objectId" }, status: { enum: ["running", "complete", "failed"] }, createdAt: date,
      evidence: { bsonType: "array", items: { bsonType: "object", required: ["id", "tool", "claim", "value", "generatedAt"] } } },
  },
};

export async function applyValidators(db) {
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  for (const [name, $jsonSchema] of Object.entries(VALIDATORS)) {
    const opts = { validator: { $jsonSchema }, validationLevel: "strict", validationAction: "error" };
    if (existing.has(name)) await db.command({ collMod: name, ...opts });
    else await db.createCollection(name, opts);
  }
}
