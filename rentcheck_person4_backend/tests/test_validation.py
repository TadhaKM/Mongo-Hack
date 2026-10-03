from app.ingestion.validator import validate_point, plausibility_flags_for_rent

def test_coordinates():
    assert validate_point(-6.26, 53.35) == []
    assert "missing_coordinates" in validate_point(None, None)
    assert "invalid_coordinates" in validate_point(500, 53)

def test_rent_flags():
    assert plausibility_flags_for_rent(2000) == []
    assert "non_positive_rent" in plausibility_flags_for_rent(0)
    assert "rent_outlier" in plausibility_flags_for_rent(25001)
