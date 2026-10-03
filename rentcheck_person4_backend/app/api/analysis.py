from fastapi import APIRouter, HTTPException

from app.models.schemas import AnalyseRequest
from app.services.analysis_service import create_analysis, get_analysis
from app.services.property_service import get_property
from app.services.rental_service import rental_history
from app.services.transport_service import nearby_transport
from app.services.planning_service import nearby_planning
from app.services.neighbourhood_service import neighbourhood_data
from app.services.sales_service import property_sales


router = APIRouter(tags=["analysis"])


def _property_or_404(property_id: str):
    doc = get_property(property_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Property not found")
    return doc


@router.post("/analyse")
def post_analyse(payload: AnalyseRequest):
    """
    Start an analysis for an existing property.
    """
    try:
        return create_analysis(
            payload.property_id,
            payload.requested_analysis,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/analysis/{analysis_id}")
def read_analysis(analysis_id: str):
    """
    Get the overall analysis object.
    """
    result = get_analysis(analysis_id)

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    return result


@router.get("/analysis/{analysis_id}/comparables")
def comparables(analysis_id: str):
    """
    Get rental comparable evidence for an analysis.
    """
    analysis = get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    return analysis.get("evidence", {}).get("rental", {})


@router.get("/analysis/{analysis_id}/transport")
def transport(analysis_id: str):
    """
    Get nearby transport evidence for an analysis.
    """
    analysis = get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    return analysis.get("evidence", {}).get("transport", {})


@router.get("/analysis/{analysis_id}/planning")
def planning(analysis_id: str):
    """
    Get nearby planning evidence for an analysis.
    """
    analysis = get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    return analysis.get("evidence", {}).get("planning", {})


@router.get("/analysis/{analysis_id}/neighbourhood")
def neighbourhood(analysis_id: str):
    """
    Get neighbourhood evidence for an analysis.
    """
    analysis = get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    return analysis.get("evidence", {}).get("neighbourhood", {})


@router.get("/analysis/{analysis_id}/sales")
def sales(analysis_id: str):
    """
    Get property sales evidence for an analysis.
    """
    analysis = get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    return analysis.get("evidence", {}).get("sales", {})


@router.get("/analysis/{analysis_id}/report")
def report(analysis_id: str):
    """
    Get the complete analysis/report.
    """
    analysis = get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    return analysis


@router.get("/analysis/{analysis_id}/live/rental-history")
def live_rental_history(
    analysis_id: str,
    years: int = 5,
):
    """
    Retrieve rental history directly from the underlying property data.
    """
    analysis = get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    property_doc = _property_or_404(
        analysis["property_id"]
    )

    return rental_history(
        property_doc,
        years,
    )


@router.get("/analysis/{analysis_id}/live/evidence")
def live_evidence(
    analysis_id: str,
    radius_transport_m: int = 500,
    radius_planning_m: int = 1000,
):
    """
    Retrieve live evidence services for an existing analysis.
    """
    analysis = get_analysis(analysis_id)

    if not analysis:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found",
        )

    property_doc = _property_or_404(
        analysis["property_id"]
    )

    return {
        "transport": nearby_transport(
            property_doc,
            radius_transport_m,
        ),
        "planning": nearby_planning(
            property_doc,
            radius_planning_m,
        ),
        "neighbourhood": neighbourhood_data(
            property_doc,
        ),
        "sales": property_sales(
            property_doc,
        ),
    }
