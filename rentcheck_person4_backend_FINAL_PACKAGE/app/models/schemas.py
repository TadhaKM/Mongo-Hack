from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field, ConfigDict

class Point(BaseModel):
    type: Literal["Point"] = "Point"
    coordinates: tuple[float, float]

class PropertyCreate(BaseModel):
    address: str = Field(min_length=3)
    eircode: str | None = None
    postal_area: str | None = None
    property_type: str | None = None
    bedrooms: int | None = Field(default=None, ge=0, le=20)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

class GeographyRef(BaseModel):
    code: str | None = None
    name: str | None = None

class PropertyResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    property_id: str
    address: dict[str, Any]
    location: dict[str, Any]
    geography: dict[str, Any] = {}
    property_attributes: dict[str, Any] = {}

class AnalyseRequest(BaseModel):
    property_id: str
    requested_analysis: list[str] = ["rental", "transport", "planning", "neighbourhood", "sales"]

class AnalysisResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    analysis_id: str
    property_id: str
    status: str
    created_at: datetime | None = None

class RentalQuery(BaseModel):
    property_id: str
    bedrooms: int | None = None
    property_type: str | None = None
    period: str | None = None
    limit: int = Field(default=10, ge=1, le=100)

class RadiusQuery(BaseModel):
    property_id: str
    radius_m: int = Field(default=500, ge=1, le=10000)
    limit: int = Field(default=50, ge=1, le=500)
