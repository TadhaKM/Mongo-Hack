from __future__ import annotations
from pathlib import Path
from app.ingestion.base import DatasetImporter, ImportResult
from app.ingestion.utils import read_csv_rows, first, float_or_none
from app.geo.normalise import normalise_address
import re

class PprImporter(DatasetImporter):
    dataset_id = "ppr"
    organisation = "Property Services Regulatory Authority"
    collection_name = "property_sales"

    def import_path(self, path, source_url=None):
        rows = list(read_csv_rows(Path(path)))
        docs = []
        for i, row in enumerate(rows):
            address = first(row, "address", "property_address", default="")
            date = first(row, "date_of_sale", "sale_date", "date", default=None)
            price_raw = first(row, "price", "sale_price", default=None)
            amount = parse_money(price_raw)
            key = first(row, "sale_id", "transaction_id", default=None) or f"{date}|{address}|{amount}|{i}"
            docs.append({
                "_record_key": f"{self.dataset_id}:{key}",
                "sale_date": date,
                "price": {"amount_eur": amount, "raw": price_raw},
                "address": {"raw": address, "normalised": normalise_address(address)},
                "source": self.source_metadata(source_url or "https://propertypriceregister.ie/website/npsra/pprweb.nsf/page/ppr-home-en"),
                "validation": {"status": "ok" if amount and amount > 0 else "flagged", "issues": [] if amount and amount > 0 else ["missing_or_invalid_price"]}
            })
        return ImportResult(records_read=len(rows), records_written=self.write(docs))

def parse_money(v):
    if v is None: return None
    s = re.sub(r"[^0-9.-]", "", str(v))
    try: return float(s) if s else None
    except ValueError: return None
