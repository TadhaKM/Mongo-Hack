from app.main import app

# FastAPI 0.137+ keeps included routers as internal _IncludedRouter objects
# in app.routes. Use the generated OpenAPI contract to verify public paths
# instead of assuming every app.routes entry has a .path attribute.
def test_routes_registered():
    paths = set(app.openapi()["paths"])
    assert "/property" in paths
    assert "/analyse" in paths
    assert "/analysis/{analysis_id}" in paths
    assert "/analysis/{analysis_id}/comparables" in paths
    assert "/analysis/{analysis_id}/transport" in paths
    assert "/analysis/{analysis_id}/planning" in paths
    assert "/analysis/{analysis_id}/report" in paths
    assert "/agent/getRentalComparables/{property_id}" in paths
    assert "/daft/rental/search/{property_id}" in paths
    assert "/daft/sale/search/{property_id}" in paths
    assert "/analysis/{analysis_id}/live/daft-rental" in paths
    assert "/analysis/{analysis_id}/live/daft-sale" in paths
    assert "/agent/getDaftRentalComparables/{property_id}" in paths
    assert "/agent/getDaftSaleComparables/{property_id}" in paths
