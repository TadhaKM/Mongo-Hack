from app.geo.normalise import normalise_address

def test_normalise_address():
    assert normalise_address("  25  Example Street, Dublin 8 ") == "25 EXAMPLE STREET DUBLIN 8"
