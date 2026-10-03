"""Location helpers. Precise points come from a map click or Person 4's geocoder; this module only
supplies an approximate fallback from the Eircode routing key (first 3 characters, e.g. D08)."""
from __future__ import annotations

import re

# Approximate centroids of Eircode routing areas (lon, lat). Indicative only: results using them are
# flagged precision="routing_area" and get lower confidence for distance-based findings.
ROUTING_KEY_CENTROIDS: dict[str, tuple[float, float, str]] = {
    "D01": (-6.2600, 53.3530, "Dublin 1"), "D02": (-6.2500, 53.3390, "Dublin 2"), "D03": (-6.2330, 53.3640, "Dublin 3"),
    "D04": (-6.2280, 53.3290, "Dublin 4"), "D05": (-6.1980, 53.3850, "Dublin 5"), "D06": (-6.2650, 53.3220, "Dublin 6"),
    "D6W": (-6.2950, 53.3110, "Dublin 6W"), "D07": (-6.2850, 53.3570, "Dublin 7"), "D08": (-6.2900, 53.3390, "Dublin 8"),
    "D09": (-6.2500, 53.3800, "Dublin 9"), "D10": (-6.3500, 53.3400, "Dublin 10"), "D11": (-6.2900, 53.3920, "Dublin 11"),
    "D12": (-6.3200, 53.3230, "Dublin 12"), "D13": (-6.1500, 53.3900, "Dublin 13"), "D14": (-6.2550, 53.3000, "Dublin 14"),
    "D15": (-6.4000, 53.3850, "Dublin 15"), "D16": (-6.2700, 53.2850, "Dublin 16"), "D17": (-6.2100, 53.4000, "Dublin 17"),
    "D18": (-6.1850, 53.2650, "Dublin 18"), "D20": (-6.3800, 53.3550, "Dublin 20"), "D22": (-6.4000, 53.3250, "Dublin 22"),
    "D24": (-6.3700, 53.2900, "Dublin 24"), "A94": (-6.1780, 53.3000, "Blackrock"), "T12": (-8.4756, 51.8985, "Cork"),
    "H91": (-9.0568, 53.2707, "Galway"), "V94": (-8.6267, 52.6638, "Limerick"), "X91": (-7.1101, 52.2593, "Waterford"),
}
EIRCODE_RE = re.compile(r"\b([AC-FHKNPRTV-Y]\d{2}|D6W)\s?([0-9AC-FHKNPRTV-Y]{4})?\b", re.I)


def routing_key(text: str | None) -> str | None:
    if not text:
        return None
    m = EIRCODE_RE.search(text.upper())
    return m.group(1).upper() if m else None


def routing_centroid(text: str | None) -> tuple[float, float, str] | None:
    key = routing_key(text)
    return ROUTING_KEY_CENTROIDS.get(key) if key else None
