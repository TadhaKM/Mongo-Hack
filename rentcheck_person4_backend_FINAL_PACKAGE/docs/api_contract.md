# Stable API Contract

## POST /property

Request:
```json
{
  "address": "25 Example Street, Dublin 8",
  "eircode": null,
  "property_type": "apartment",
  "bedrooms": 2,
  "latitude": 53.3400,
  "longitude": -6.3000
}
```

Response contains `property_id`, canonical GeoJSON `location`, resolved geography and property attributes.

## POST /analyse

```json
{
  "property_id": "property_123",
  "requested_analysis": ["rental", "transport", "planning", "neighbourhood", "sales"]
}
```

## GET /analysis/{id}

Returns status, evidence sections and sources.

## GET /analysis/{id}/comparables

Returns RTB/ESRI rental evidence plus explicit match metadata.

## GET /analysis/{id}/transport

Returns nearby stops, route IDs, modes and straight-line distance.

## GET /analysis/{id}/planning

Returns applications within a requested radius with reference/date/decision/status/proposal/distance.

## GET /analysis/{id}/neighbourhood

Returns the resolved Small Area plus CSO/vacancy values if ingested.

## GET /analysis/{id}/sales

Returns PPR sales evidence. Responses contain a warning that sale price is not rental value.

## GET /analysis/{id}/report

Returns all evidence and source metadata in one frontend-friendly payload.

## Agent endpoints

`/agent/getProperty/{property_id}`
`/agent/getRentalComparables/{property_id}`
`/agent/getRentalHistory/{property_id}`
`/agent/getNearbyTransport/{property_id}`
`/agent/getNeighbourhoodData/{property_id}`
`/agent/getNearbyPlanning/{property_id}`
`/agent/getPropertySales/{property_id}`

## Daft live endpoints

Daft V3 is exposed as an optional live-only integration. Responses are not cached or persisted by this backend.

### Rental

`GET /agent/getDaftRentalComparables/{property_id}?radius_m=5000&limit=10&bedrooms=2&property_type=apartment`

### Sale

`GET /agent/getDaftSaleComparables/{property_id}?radius_m=5000&limit=10&bedrooms=2&property_type=apartment`

The response includes listing ID, Daft URL, rent/price, bedrooms/bathrooms, address/location, calculated distance, and source/terms metadata. Weekly rental amounts are also exposed as a derived monthly figure using `weekly * 52 / 12`.

Daft results are live evidence only and are deliberately excluded from persistent analysis documents because Daft's terms prohibit building an independent property database from API results.


## Daft live HTTP API

```text
GET /daft/rental/search/{property_id}
GET /daft/sale/search/{property_id}
```

These endpoints call Daft V3 live via SOAP. They use the property coordinate to request distance-sorted results and apply the requested radius to returned geocoded ads. No Daft listing result is persisted in MongoDB.
