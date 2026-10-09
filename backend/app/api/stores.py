"""Store finder endpoint: nearby shops for the items on a shopping list."""

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.api.deps import client_ip
from app.api.schemas import StoresRequest
from app.services import stores
# ====================================================================================

router = APIRouter(prefix="/api/stores", tags=["stores"])


@router.post("")
def nearby(body: StoresRequest, request: Request):
  try:
    result = stores.find_stores(body.lat, body.lon, body.items, client_ip(request))
  except stores.RateLimited:
    raise HTTPException(status_code=429, detail="Too many store searches. Try again in a while.")
  except httpx.HTTPError:
    raise HTTPException(status_code=502, detail="Store search is unavailable right now. Try again in a moment.")
  result["attribution"] = "Shop data from OpenStreetMap contributors"
  return result
