from fastapi import APIRouter, HTTPException, Query

from app.daft.client import DaftApiError, DaftApiNotConfigured, live_property_search
from app.db.mongodb import collection

router = APIRouter(prefix="/daft", tags=["daft-live"])


def _prop(pid: str) -> dict:
    doc = collection("properties").find_one({"_id": pid})
    if not doc:
        raise HTTPException(status_code=404, detail="Property not found")
    return doc


def _run(property_id: str, kind: str, radius_m: int, limit: int, bedrooms: int | None, property_type: str | None):
    try:
        return live_property_search(
            _prop(property_id),
            ad_type=kind,
            radius_m=radius_m,
            limit=limit,
            bedrooms=bedrooms,
            property_type=property_type,
        )
    except DaftApiNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except DaftApiError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/rental/search/{property_id}")
def daft_rental_search(
    property_id: str,
    radius_m: int = Query(5000, ge=1, le=20000),
    limit: int = Query(10, ge=1, le=50),
    bedrooms: int | None = Query(None, ge=0, le=20),
    property_type: str | None = None,
):
    return _run(property_id, "rental", radius_m, limit, bedrooms, property_type)


@router.get("/sale/search/{property_id}")
def daft_sale_search(
    property_id: str,
    radius_m: int = Query(5000, ge=1, le=20000),
    limit: int = Query(10, ge=1, le=50),
    bedrooms: int | None = Query(None, ge=0, le=20),
    property_type: str | None = None,
):
    return _run(property_id, "sale", radius_m, limit, bedrooms, property_type)
