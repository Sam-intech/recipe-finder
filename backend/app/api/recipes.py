"""Recipe search plus the two AI endpoints, which share one cache and one set of limits."""

from dataclasses import asdict

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from app.api.deps import client_ip
from app.api.schemas import GenerateRequest, PolishRequest
from app.services import ai_recipes, limits, recipes
# ====================================================================================

TIRED_MESSAGE = "Recipe Finder is tired, come back later 🧸💤"
# ====================================================================================

router = APIRouter(prefix="/api/recipes", tags=["recipes"])


@router.get("")
def search(q: str = Query(min_length=1, max_length=100)):
  try:
    results = recipes.search_recipes(q)
  except httpx.HTTPError:
    raise HTTPException(status_code=502, detail="Recipe service is unavailable right now.")
  return {"query": q, "results": [asdict(r) for r in results]}


def _call_ai(request: Request, make):
  """Spend one AI slot and run `make()`, turning AI failures into HTTP errors.
  Callers check the cache first, so only a real AI call spends a slot."""
  try:
    limits.guard.take_slot(client_ip(request))
  except limits.LimitReached:
    raise HTTPException(status_code=429, detail=TIRED_MESSAGE)
  try:
    return make()
  except ai_recipes.AINotConfigured:
    raise HTTPException(status_code=503, detail="AI generation isn't set up on this server.")
  except ai_recipes.AIRecipeError:
    raise HTTPException(status_code=502, detail="The AI couldn't produce a usable recipe. Try again.")


@router.post("/generate")
def generate(body: GenerateRequest, request: Request):
  # Cache first: a dish someone already generated costs nothing and uses no limits.
  recipe = limits.guard.cached(body.q)
  if recipe is limits.MISSING:
    recipe = _call_ai(request, lambda: ai_recipes.generate_recipe(body.q))
    # Failures are not cached, so a retry can succeed. "Not a dish" (None) is cached.
    limits.guard.remember(body.q, recipe)
  if recipe is None:
    raise HTTPException(status_code=422, detail="That doesn't look like a dish. Try a dish name.")
  return {"recipe": asdict(recipe)}


@router.post("/polish")
def polish(body: PolishRequest, request: Request):
  recipe = limits.guard.cached(body.id, kind="polish")
  if recipe is limits.MISSING:
    # Look the recipe up before spending a slot, so a bad id costs nothing.
    try:
      original = recipes.get_recipe(body.id)
    except httpx.HTTPError:
      raise HTTPException(status_code=502, detail="Recipe service is unavailable right now.")
    if original is None:
      raise HTTPException(status_code=404, detail="That recipe isn't in the database.")
    recipe = _call_ai(request, lambda: ai_recipes.polish_recipe(original))
    limits.guard.remember(body.id, recipe, kind="polish")
  return {"recipe": asdict(recipe)}
