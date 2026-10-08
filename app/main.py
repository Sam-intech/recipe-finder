"""HTTP layer. Thin on purpose: all logic lives in app.core."""

from dataclasses import asdict
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.core import ai_recipes, recipes, shopping
from app.core.recipes import Ingredient
# ====================================================================================

STATIC_DIR = Path(__file__).parent / "static"
# ====================================================================================

app = FastAPI(title="Recipe Finder")


class IngredientIn(BaseModel):
  name: str = Field(min_length=1, max_length=200)
  measure: str = Field(default="", max_length=200)


class ShoppingListRequest(BaseModel):
  # The client sends the recipe it is looking at. This keeps AI-generated recipes (which have
  # no database id to look up) working the same way as database ones.
  recipe_name: str = Field(min_length=1, max_length=200)
  ingredients: list[IngredientIn] = Field(max_length=60)
  have: list[str] = Field(default=[], max_length=60)


class GenerateRequest(BaseModel):
  q: str = Field(min_length=1, max_length=ai_recipes.MAX_QUERY_CHARS)


def _items(body: ShoppingListRequest) -> list[Ingredient]:
  ingredients = [Ingredient(name=i.name, measure=i.measure) for i in body.ingredients]
  return shopping.build_shopping_list(recipes.merge_duplicates(ingredients), body.have)


@app.get("/api/recipes")
def search(q: str = Query(min_length=1, max_length=100)):
  try:
    results = recipes.search_recipes(q)
  except httpx.HTTPError:
    raise HTTPException(status_code=502, detail="Recipe service is unavailable right now.")
  return {"query": q, "results": [asdict(r) for r in results]}


@app.post("/api/recipes/generate")
def generate(body: GenerateRequest):
  try:
    recipe = ai_recipes.generate_recipe(body.q)
  except ai_recipes.AINotConfigured:
    raise HTTPException(status_code=503, detail="AI generation isn't set up on this server.")
  except ai_recipes.AIRecipeError:
    raise HTTPException(status_code=502, detail="The AI couldn't produce a usable recipe. Try again.")
  if recipe is None:
    raise HTTPException(status_code=422, detail="That doesn't look like a dish. Try a dish name.")
  return {"recipe": asdict(recipe)}


@app.post("/api/shopping-list")
def shopping_list(body: ShoppingListRequest):
  return {"recipe": body.recipe_name, "items": [asdict(i) for i in _items(body)]}


@app.post("/api/shopping-list/export")
def export(body: ShoppingListRequest, format: str = Query("csv", pattern="^(csv|md)$")):
  items = _items(body)
  if format == "csv":
    content, media, ext = shopping.to_csv(body.recipe_name, items), "text/csv", "csv"
  else:
    content, media, ext = shopping.to_markdown(body.recipe_name, items), "text/markdown", "md"
  return Response(
    content=content,
    media_type=media,
    headers={"Content-Disposition": f'attachment; filename="shopping-list.{ext}"'},
  )


@app.get("/")
def index():
  return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
