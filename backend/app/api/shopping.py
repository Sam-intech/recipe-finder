"""Shopping list endpoints. Stateless: the client sends the recipe each time."""

from dataclasses import asdict

from fastapi import APIRouter, Query
from fastapi.responses import Response

from app.api.schemas import ShoppingListRequest
from app.services import recipes, shopping
from app.services.recipes import Ingredient

router = APIRouter(prefix="/api/shopping-list", tags=["shopping"])


def _items(body: ShoppingListRequest) -> list[Ingredient]:
  ingredients = [Ingredient(name=i.name, measure=i.measure) for i in body.ingredients]
  return shopping.build_shopping_list(recipes.merge_duplicates(ingredients), body.have)


@router.post("")
def shopping_list(body: ShoppingListRequest):
  return {"recipe": body.recipe_name, "items": [asdict(i) for i in _items(body)]}


@router.post("/export")
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
