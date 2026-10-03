from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "RentCheck AI API"
    environment: str = "development"
    mongodb_uri: str = "mongodb://localhost:27017"
    mongodb_database: str = "rentcheck"
    geocoder_provider: str = "nominatim"
    geocoder_base_url: str = "https://nominatim.openstreetmap.org"
    geocoder_user_agent: str = "rentcheck-ai-hackathon/0.1"
    request_timeout_seconds: int = 30
    cache_ttl_seconds: int = 3600
    met_api_base_url: str = "https://opendata2.met.ie/edr"
    epa_base_url: str = "https://data.epa.ie"

    # Daft API V3 is an optional live SOAP integration. Keep disabled until
    # the account/key is authorised for this use case under Daft's terms.
    # Person 1's MongoDB engine gateway (node db/server.js). Unset = /engine routes answer 503.
    engine_url: str | None = None

    daft_api_enabled: bool = False
    daft_api_authorised: bool = False
    daft_api_key: str | None = None
    daft_wsdl_url: str = "http://api.daft.ie/v3/wsdl.xml"
    daft_timeout_seconds: int = 20
    daft_max_pages: int = 2

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
