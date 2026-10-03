from __future__ import annotations
import json
from pathlib import Path
import pandas as pd
from app.ingestion.base import DatasetImporter, ImportResult
from app.ingestion.utils import first

class CsoCsvImporter(DatasetImporter):
    collection_name = "census_saps"
    dataset_id = "census_2022_saps"
    organisation = "Central Statistics Office"

    def import_path(self, path, source_url=None):
        df = pd.read_csv(path)
        docs=[]
        for i, row in df.iterrows():
            rec = {str(k): row[k] for k in df.columns if pd.notna(row[k])}
            code = first(rec, "small_area_code", "small_area", "geographic_code", "geography_code")
            if not code: continue
            docs.append({"_record_key": f"{self.dataset_id}:{code}", "small_area_code": str(code), "values": rec, "source": self.source_metadata(source_url or "https://www.cso.ie/en/census/census2022/census2022smallareapopulationstatistics/")})
        return ImportResult(records_read=len(df), records_written=self.write(docs))

class VacancyCsvImporter(DatasetImporter):
    collection_name = "vacancy"
    dataset_id = "cso_fp010"

    def import_path(self, path, source_url=None):
        df = pd.read_csv(path)
        docs=[]
        for i, row in df.iterrows():
            rec={str(k): row[k] for k in df.columns if pd.notna(row[k])}
            code=first(rec, "small_area_code", "small_area", "geography_code", "code")
            if not code: continue
            docs.append({"_record_key": f"{self.dataset_id}:{code}", "geography": {"code": str(code)}, "values": rec, "data_year": 2022, "source": self.source_metadata(source_url or "https://data.gov.ie/dataset/fp010-housing-stock-and-vacant-dwellings-2022", 2022)})
        return ImportResult(records_read=len(df), records_written=self.write(docs))
