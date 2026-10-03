from app.main import app


def test_routes_registered():
    """
    Verify the public API contract through FastAPI's OpenAPI schema.

    This is more reliable than iterating over app.routes directly because
    modern FastAPI versions may contain internal router objects that do not
    expose a .path attribute.
    """
    paths = set(app.openapi()["paths"])

    assert "/property" in paths
    assert "/analyse" in paths

    assert "/analysis/{analysis_id}" in paths
    assert "/analysis/{analysis_id}/comparables" in paths
    assert "/analysis/{analysis_id}/transport" in paths
    assert "/analysis/{analysis_id}/planning" in paths
    assert "/analysis/{analysis_id}/neighbourhood" in paths
    assert "/analysis/{analysis_id}/sales" in paths
    assert "/analysis/{analysis_id}/report" in paths

    assert "/agent/getRentalComparables/{property_id}" in paths
    assert "/daft/rental/search/{property_id}" in paths
    assert "/daft/sale/search/{property_id}" in paths
    assert "/analysis/{analysis_id}/live/daft-rental" in paths
    assert "/analysis/{analysis_id}/live/daft-sale" in paths
    assert "/agent/getDaftRentalComparables/{property_id}" in paths
    assert "/agent/getDaftSaleComparables/{property_id}" in paths
