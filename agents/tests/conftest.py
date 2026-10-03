import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from rentcheck_agents.models import PropertyInput  # noqa: E402
from rentcheck_agents.store import MemoryAnalysisStore  # noqa: E402
from rentcheck_agents.tools.mock_client import MockToolClient  # noqa: E402

TODAY = date(2026, 10, 3)


@pytest.fixture
def tools():
    return MockToolClient()


@pytest.fixture
def store():
    return MemoryAnalysisStore()


@pytest.fixture
def dublin8():
    return PropertyInput(address="South Circular Road, Dublin 8", latitude=53.3392, longitude=-6.2905,
                         monthly_rent=2200, bedrooms=2, property_type="apartment")


@pytest.fixture
def rural():
    return PropertyInput(address="Ballymahon, Co. Longford", latitude=53.5640, longitude=-7.7640,
                         monthly_rent=1400, bedrooms=5, property_type="house")
