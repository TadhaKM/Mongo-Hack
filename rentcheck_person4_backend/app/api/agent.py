from fastapi import APIRouter, HTTPException
from app.services.property_service import get_property
from app.services.rental_service import rental_comparables, rental_history
from app.services.transport_service import nearby_transport
from app.services.planning_service import nearby_planning
from app.services.neighbourhood_service import neighbourhood_data
from app.services.sales_service import property_sales

router = APIRouter(prefix="/agent", tags=["agent-tools"])

def prop(pid):
    p = get_property(pid)
    if not p: raise HTTPException(status_code=404, detail="Property not found")
    return p

@router.get("/getProperty/{property_id}")
def getProperty(property_id: str): return prop(property_id)

@router.get("/getRentalComparables/{property_id}")
def getRentalComparables(property_id: str, bedrooms: int | None = None, property_type: str | None = None, period: str | None = None):
    return rental_comparables(prop(property_id), bedrooms, property_type, period)

@router.get("/getRentalHistory/{property_id}")
def getRentalHistory(property_id: str, years: int = 5): return rental_history(prop(property_id), years)

@router.get("/getNearbyTransport/{property_id}")
def getNearbyTransport(property_id: str, radius_m: int = 500): return nearby_transport(prop(property_id), radius_m)

@router.get("/getNeighbourhoodData/{property_id}")
def getNeighbourhoodData(property_id: str): return neighbourhood_data(prop(property_id))

@router.get("/getNearbyPlanning/{property_id}")
def getNearbyPlanning(property_id: str, radius_m: int = 1000): return nearby_planning(prop(property_id), radius_m)

@router.get("/getPropertySales/{property_id}")
def getPropertySales(property_id: str, radius_m: int = 1000, years: int = 10): return property_sales(prop(property_id), radius_m, years)
