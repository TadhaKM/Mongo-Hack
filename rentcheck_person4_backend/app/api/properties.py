from fastapi import APIRouter, HTTPException
from app.models.schemas import PropertyCreate, PropertyResponse
from app.services.property_service import create_property, get_property

router = APIRouter(prefix="/property", tags=["property"])

@router.post("", response_model=PropertyResponse)
async def post_property(payload: PropertyCreate):
    try:
        return await create_property(payload.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))

@router.get("/{property_id}", response_model=PropertyResponse)
def read_property(property_id: str):
    result = get_property(property_id)
    if not result:
        raise HTTPException(status_code=404, detail="Property not found")
    return result
