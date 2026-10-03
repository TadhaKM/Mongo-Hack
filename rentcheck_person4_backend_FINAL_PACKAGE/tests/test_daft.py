from app.daft.client import _monthly_rent, _normalise_ad


def test_weekly_rent_converts_to_monthly():
    assert _monthly_rent({"rent": 400, "rent_collection_period": "weekly"}) == round(400 * 52 / 12, 2)


def test_monthly_rent_is_preserved():
    assert _monthly_rent({"rent": 1900, "rent_collection_period": "monthly"}) == 1900


def test_normalise_daft_ad_keeps_live_fields_and_distance():
    property_point = {"type": "Point", "coordinates": [-6.2600, 53.3500]}
    ad = {
        "ad_id": 123,
        "daft_url": "https://www.daft.ie/example",
        "property_type": "apartment",
        "bedrooms": 2,
        "bathrooms": 1,
        "rent": 2000,
        "rent_collection_period": "monthly",
        "latitude": 53.3510,
        "longitude": -6.2600,
        "latlon_accuracy": 1,
        "full_address": "Example Address, Dublin",
    }
    result = _normalise_ad(ad, "rental", property_point)
    assert result["ad_id"] == 123
    assert result["monthly_rent_eur"] == 2000
    assert result["distance_m"] is not None
    assert result["daft_url"].startswith("https://")
