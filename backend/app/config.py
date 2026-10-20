"""All settings in one place, read from environment variables.

Locally they come from backend/.env (see .env.example). In production, set them in the hosting
provider's dashboard instead; a missing .env file is simply ignored.
"""

from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
  model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

  # Recipe database. "1" is TheMealDB's dev/educational key; a public app needs a paid one.
  themealdb_api_key: str = "1"

  # AI. Without a key, the AI endpoints answer with a clear "not set up" error.
  gemini_api_key: str = ""
  gemini_model: str = "gemini-3.5-flash-lite"

  # Limits on the paid AI calls. See app/services/limits.py.
  ai_daily_cap: int = Field(default=20, ge=0)
  ai_per_ip_limit: int = Field(default=5, ge=0)

  # Store finder: shop data from OpenStreetMap through the free Overpass API. It is a shared
  # public service, so keep the limit modest and give it a way to contact you (see README).
  overpass_url: str = "https://overpass-api.de/api/interpreter"
  overpass_user_agent: str = "recipe-finder (set OVERPASS_USER_AGENT to include your contact)"
  store_radius_m: int = Field(default=5000, ge=500, le=25000)
  store_per_ip_limit: int = Field(default=20, ge=0)

  # Websites allowed to call this API from a browser, comma separated, e.g.
  # "https://recipes.example.com". The default is the Vite dev server.
  cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:5173"]

  # How many proxies in front of the app append to X-Forwarded-For. 0 means trust no header
  # and use the connecting address. Set it to match your host (see README), or the per-IP
  # limit sees the proxy's address, or a spoofable one, instead of the user's.
  trusted_proxy_hops: int = Field(default=0, ge=0)

  @field_validator("cors_origins", mode="before")
  @classmethod
  def _split_origins(cls, value):
    if isinstance(value, str):
      return [o.strip().rstrip("/") for o in value.split(",") if o.strip()]
    return value


settings = Settings()
