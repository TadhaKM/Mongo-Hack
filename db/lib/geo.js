// GeoJSON helpers. Coordinates are always [longitude, latitude] (WGS84).

export const EARTH_RADIUS_M = 6378100;

export function point(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new TypeError("lng/lat must be numbers");
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) throw new RangeError("lng/lat out of range");
  // Island of Ireland bounding box. Catches swapped lat/lng, the commonest geocoding-handoff bug.
  if (lng < -11 || lng > -5 || lat < 51 || lat > 56) {
    throw new RangeError(`(${lng}, ${lat}) is outside Ireland. Are lat/lng swapped? GeoJSON order is [lng, lat].`);
  }
  return { type: "Point", coordinates: [lng, lat] };
}

/** metres -> radians on the Earth sphere, as required by $centerSphere */
export const metresToRadians = (m) => m / EARTH_RADIUS_M;

export const round = (x, dp = 1) => (x == null ? x : Math.round(x * 10 ** dp) / 10 ** dp);
