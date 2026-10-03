from __future__ import annotations

import math
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from app.config import get_settings
from app.geo.distance import haversine_m


class DaftApiError(RuntimeError):
    """Raised when the Daft API cannot be used successfully."""


class DaftApiNotConfigured(DaftApiError):
    """Raised when live Daft access has not been explicitly configured."""


def _plain(value: Any) -> Any:
    """Convert Zeep objects/collections into JSON-friendly Python values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): _plain(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(v) for v in value]
    # Zeep objects expose their fields via __values__.
    values = getattr(value, "__values__", None)
    if isinstance(values, dict):
        return {str(k): _plain(v) for k, v in values.items()}
    try:
        return dict(value)
    except Exception:
        return str(value)


def _unwrap_results(response: Any) -> dict[str, Any]:
    data = _plain(response)
    if not isinstance(data, dict):
        return {"raw": data}
    results = data.get("results")
    if isinstance(results, dict):
        return results
    return data


@lru_cache(maxsize=1)
def _soap_service():
    """Create one in-process SOAP service object; this is not API-result caching."""
    settings = get_settings()
    if not settings.daft_api_key:
        raise DaftApiNotConfigured("DAFT_API_KEY is not configured.")
    if not settings.daft_api_enabled:
        raise DaftApiNotConfigured("Daft API integration is disabled.")
    if not settings.daft_api_authorised:
        raise DaftApiNotConfigured(
            "DAFT_API_AUTHORISED is false. Confirm your Daft API terms/permission before enabling this integration."
        )

    try:
        from zeep import Client, Settings as ZeepSettings
        from zeep.transports import Transport
    except ImportError as exc:  # pragma: no cover - exercised only in misconfigured envs
        raise DaftApiNotConfigured("The 'zeep' package is not installed.") from exc

    transport = Transport(timeout=settings.daft_timeout_seconds)
    zeep_settings = ZeepSettings(strict=False, xml_huge_tree=True)
    client = Client(settings.daft_wsdl_url, transport=transport, settings=zeep_settings)
    return client.service


def _call(method: str, query: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = get_settings()
    service = _soap_service()
    params: dict[str, Any] = {"api_key": settings.daft_api_key}
    if query is not None:
        params["query"] = query

    try:
        response = getattr(service, method)(params)
    except Exception as exc:
        # Don't leak the API key or SOAP headers into logs/responses.
        raise DaftApiError(f"Daft API request '{method}' failed: {exc}") from exc
    return _unwrap_results(response)


def search_rental(query: dict[str, Any]) -> dict[str, Any]:
    return _call("search_rental", query)


def search_sale(query: dict[str, Any]) -> dict[str, Any]:
    return _call("search_sale", query)


def ad_types() -> dict[str, Any]:
    return _call("ad_types")


def property_types(ad_type: str) -> dict[str, Any]:
    return _call("property_types", {"ad_type": ad_type})


def areas(area_type: str, ad_type: str | None = None) -> dict[str, Any]:
    query: dict[str, Any] = {"area_type": area_type}
    if ad_type:
        query["ad_type"] = ad_type
    return _call("areas", query)


def _monthly_rent(ad: dict[str, Any]) -> float | None:
    rent = ad.get("rent")
    if rent in (None, ""):
        return None
    try:
        value = float(rent)
    except (TypeError, ValueError):
        return None
    period = str(ad.get("rent_collection_period") or "monthly").lower()
    if period == "weekly":
        return round(value * 52 / 12, 2)
    return value


def _normalise_ad(ad: dict[str, Any], ad_type: str, property_point: dict[str, Any] | None = None) -> dict[str, Any]:
    lat = ad.get("latitude")
    lon = ad.get("longitude")
    if lat is not None:
        try:
            lat = float(lat)
        except (TypeError, ValueError):
            lat = None
    if lon is not None:
        try:
            lon = float(lon)
        except (TypeError, ValueError):
            lon = None

    distance_m = None
    if property_point and lat is not None and lon is not None:
        p_lon, p_lat = property_point["coordinates"]
        distance_m = round(haversine_m(p_lon, p_lat, lon, lat), 1)

    result = {
        "ad_id": ad.get("ad_id"),
        "daft_url": ad.get("daft_url"),
        "ad_type": ad_type,
        "property_type": ad.get("property_type"),
        "house_type": ad.get("house_type"),
        "bedrooms": ad.get("bedrooms"),
        "bathrooms": ad.get("bathrooms"),
        "price_eur": ad.get("price"),
        "rent": ad.get("rent"),
        "rent_collection_period": ad.get("rent_collection_period"),
        "monthly_rent_eur": _monthly_rent(ad),
        "furnished": ad.get("furnished"),
        "lease_length_months": ad.get("lease_length"),
        "features": ad.get("features") or [],
        "ber_rating": ad.get("ber_rating"),
        "ber_code": ad.get("ber_code"),
        "square_metres": ad.get("square_metres"),
        "address": ad.get("address"),
        "full_address": ad.get("full_address"),
        "area": ad.get("area"),
        "county": ad.get("county"),
        "city": ad.get("city"),
        "general_area": ad.get("general_area"),
        "postcode": ad.get("postcode"),
        "latitude": lat,
        "longitude": lon,
        "latlon_accuracy": ad.get("latlon_accuracy"),
        "listing_date": ad.get("listing_date"),
        "start_date": ad.get("start_date"),
        "available_date": ad.get("available_date"),
        "agreed": ad.get("agreed"),
        "agency_name": ad.get("agency_name"),
        "distance_m": distance_m,
    }

    # Explicitly do not return employee-only fields if an account happens to expose them.
    for private_field in ("agent_id", "contact_name", "phone1", "phone2", "main_email", "cc_email"):
        result.pop(private_field, None)
    return result


def _base_query(
    property_doc: dict[str, Any],
    *,
    bedrooms: int | None,
    property_type: str | None,
    perpage: int,
    page: int,
) -> dict[str, Any]:
    point = property_doc["location"]
    lon, lat = point["coordinates"]
    query: dict[str, Any] = {
        "country": "roi",
        "perpage": min(max(perpage, 1), 100),
        "page": max(page, 1),
        "sort_by": "distance_custom",
        "sort_ascending": True,
        "distance_sort_latitude": float(lat),
        "distance_sort_longitude": float(lon),
        "agreed": 0,
        "images": 0,
    }
    if bedrooms is not None:
        query["bedrooms"] = int(bedrooms)
    if property_type:
        query["property_type"] = [str(property_type)]
    return query


def live_property_search(
    property_doc: dict[str, Any],
    *,
    ad_type: str,
    radius_m: int = 5000,
    bedrooms: int | None = None,
    property_type: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    """Search Daft live and filter returned geocoded ads by distance.

    The API itself is sorted by distance to the requested point, while the
    radius filter is applied locally after each response. No result is stored.
    """
    if radius_m < 1 or radius_m > 20000:
        raise ValueError("radius_m must be between 1 and 20000")
    if limit < 1 or limit > 50:
        raise ValueError("limit must be between 1 and 50")

    settings = get_settings()
    pages = min(settings.daft_max_pages, 3)
    perpage = min(max(limit * 2, 10), 50)
    point = property_doc["location"]
    search_fn = search_rental if ad_type == "rental" else search_sale

    matches: list[dict[str, Any]] = []
    raw_pagination = None
    raw_sentence = None

    for page in range(1, pages + 1):
        query = _base_query(
            property_doc,
            bedrooms=bedrooms,
            property_type=property_type,
            perpage=perpage,
            page=page,
        )
        payload = search_fn(query)
        pagination = payload.get("pagination")
        if pagination is not None:
            raw_pagination = pagination
        raw_sentence = payload.get("search_sentence", raw_sentence)
        ads = payload.get("ads") or []
        if not isinstance(ads, list):
            ads = list(ads)

        for ad in ads:
            if not isinstance(ad, dict):
                continue
            item = _normalise_ad(ad, ad_type, point)
            if item["distance_m"] is not None and item["distance_m"] <= radius_m:
                matches.append(item)
                if len(matches) >= limit:
                    break
        if len(matches) >= limit or len(ads) < perpage:
            break

    matches.sort(key=lambda x: x["distance_m"] if x["distance_m"] is not None else math.inf)

    return {
        "radius_m": radius_m,
        "limit": limit,
        "results": matches[:limit],
        "count": min(len(matches), limit),
        "pagination": raw_pagination,
        "search_sentence": raw_sentence,
        "source": {
            "organisation": "Daft.ie",
            "dataset": f"Daft API V3 {ad_type} listings",
            "source_url": "https://api.daft.ie/doc/v3/",
            "terms_url": "https://api.daft.ie/doc/terms/terms.html",
            "retrieved_at": datetime.now(timezone.utc),
            "storage": "live_only_no_persistence",
        },
        "display_attribution": "Properties by Daft.ie",
        "attribution_url": "https://www.daft.ie/",
        "notice": "Live Daft API results. Do not cache, persist, or republish outside the authorised Daft application.",
    }
