from __future__ import annotations
from pathlib import Path
from app.ingestion.base import DatasetImporter, ImportResult
from app.ingestion.utils import read_csv_rows, first, float_or_none, int_or_none

class RtbManualImporter(DatasetImporter):
    """Manual-file RTB importer. Intentionally does not scrape or auto-download RTB website materials."""
    dataset_id = "rtb_esri_rent_index"
    organisation = "Residential Tenancies Board / ESRI"
    collection_name = "rent_index"

    def import_path(self, path, source_url=None):
        rows = list(read_csv_rows(Path(path)))
        docs = []
        for idx, row in enumerate(rows):
            area_code = first(row, "area_code", "location_code", "rtb_area_code", "rental_area_code")
            area_name = first(row, "area_name", "location_name", "rtb_area", "location")
            rent = parse_rent(first(row, "average_rent", "monthly_rent", "rent"))
            bedroom = int_or_none(first(row, "bedrooms", "bedroom_count"))
            ptype = first(row, "property_type", "dwelling_type", "type")
            year = int_or_none(first(row, "year", "period_year"))
            quarter = int_or_none(first(row, "quarter", "period_quarter"))
            key = first(row, "record_id", "id") or f"{area_code}|{area_name}|{year}|{quarter}|{ptype}|{bedroom}|{idx}"
            issues = [] if rent is not None and rent > 0 else ["missing_or_invalid_rent"]
            docs.append({
                "_record_key": f"{self.dataset_id}:{key}",
                "geography": {"code": area_code, "name": area_name, "type": "rtb_rental_area"},
                "period": {"year": year, "quarter": quarter},
                "property": {"type": normalise_property_type(ptype), "bedrooms": bedroom},
                "rent": {"monthly_eur": rent, "measure": "average"},
                "validation": {"status": "flagged" if issues else "ok", "issues": issues},
                "source": self.source_metadata(source_url or "https://rtb.ie/data-insights/rtb-data-hub/rtb-esri-rent-index-data-set/")
            })
        return ImportResult(records_read=len(rows), records_written=self.write(docs))

def parse_rent(v):
    if v is None: return None
    try: return float(str(v).replace("€", "").replace(",", "").strip())
    except ValueError: return None

def normalise_property_type(v):
    if not v: return None
    v = str(v).strip().lower()
    aliases = {"apt": "apartment", "apts": "apartment", "flat": "apartment", "terraced": "house", "semi-detached": "house", "detached": "house"}
    return aliases.get(v, v)
