from fastapi import APIRouter, HTTPException
from app.models.schemas import AnalyseRequest
from app.services.analysis_service import create_analysis, get_analysis
from app.services.property_service import get_property
from app.services.rental_service import rental_comparables, rental_history
from app.services.transport_service import nearby_transport
from app.services.planning_service import nearby_planning
from app.services.neighbourhood_service import neighbourhood_data
from app.services.sales_service import property_sales
from app.daft.client import DaftApiError, DaftApiNotConfigured, live_property_search

router = APIRouter(tags=["analysis"])

def _property_or_404(property_id: str):
    doc = get_property(property_id)
    if not doc: raise HTTPException(status_code=404, detail="Property not found")
    return doc

@router.post("/analyse")
def post_analyse(payload: AnalyseRequest):
    try:
        return create_analysis(payload.property_id, payload.requested_analysis)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

@router.get("/analysis/{analysis_id}")
def read_analysis(analysis_id: str):
    result = get_analysis(analysis_id)
    if not result: raise HTTPException(status_code=404, detail="Analysis not found")
    return result

@router.get("/analysis/{analysis_id}/comparables")
def comparables(analysis_id: str):
    analysis = get_analysis(analysis_id)
    if not analysis: raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis.get("evidence", {}).get("rental", {})

@router.get("/analysis/{analysis_id}/transport")
def transport(analysis_id: str):
    analysis = get_analysis(analysis_id)
    if not analysis: raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis.get("evidence", {}).get("transport", {})

@router.get("/analysis/{analysis_id}/planning")
def planning(analysis_id: str):
    analysis = get_analysis(analysis_id)
    if not analysis: raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis.get("evidence", {}).get("planning", {})

@router.get("/analysis/{analysis_id}/neighbourhood")
def neighbourhood(analysis_id: str):
    analysis = get_analysis(analysis_id)
    if not analysis: raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis.get("evidence", {}).get("neighbourhood", {})

@router.get("/analysis/{analysis_id}/sales")
def sales(analysis_id: str):
    analysis = get_analysis(analysis_id)
    if not analysis: raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis.get("evidence", {}).get("sales", {})

@router.get("/analysis/{analysis_id}/report")
def report(analysis_id: str):
    analysis = get_analysis(analysis_id)
    if not analysis: raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis

@router.get("/analysis/{analysis_id}/live/rental-history")
def live_rental_history(analysis_id: str, years: int = 5):
    analysis = get_analysis(analysis_id)
    if not analysis: raise HTTPException(status_code=404, detail="Analysis not found")
    return rental_history(_property_or_404(analysis["property_id"]), years)

@router.get("/analysis/{analysis_id}/live/evidence")
def live_evidence(analysis_id: str, radius_transport_m: int = 500, radius_planning_m: int = 1000):
    analysis = get_analysis(analysis_id)
    if not analysis: raise HTTPException(status_code=404, detail="Analysis not found")
    prop = _property_or_404(analysis["property_id"])
    return {
        "transport": nearby_transport(prop, radius_transport_m),
        "planning": nearby_planning(prop, radius_planning_m),
        "neighbourhood": neighbourhood_data(prop),
        "sales": property_sales(prop)
    }


@router.get("/analysis/{analysis_id}/live/daft-rental")
def live_daft_rental(
    analysis_id: str,
    radius_m: int = 5000,
    limit: int = 10,
    bedrooms: int | None = None,
    property_type: str | None = None,
):
    analysis = get_analysis(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    try:
        return live_property_search(
            _property_or_404(analysis["property_id"]),
            ad_type="rental",
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


@router.get("/analysis/{analysis_id}/live/daft-sale")
def live_daft_sale(
    analysis_id: str,
    radius_m: int = 5000,
    limit: int = 10,
    bedrooms: int | None = None,
    property_type: str | None = None,
):
    analysis = get_analysis(analysis_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")
    try:
        return live_property_search(
            _property_or_404(analysis["property_id"]),
            ad_type="sale",
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
