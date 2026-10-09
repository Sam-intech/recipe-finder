"""Request bodies. Validation here keeps bad input away from the services and the paid AI."""

from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from app.services import ai_recipes


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


class PolishRequest(BaseModel):
  # Only the database id. The server fetches the recipe itself rather than trusting
  # whatever a client sends to the AI.
  id: str = Field(pattern=r"^\d{1,10}$")


class StoresRequest(BaseModel):
  # POST, not GET, so the user's position never ends up in a URL or in access logs.
  lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
  lon: float = Field(ge=-180, le=180, allow_inf_nan=False)
  items: list[Annotated[str, StringConstraints(min_length=1, max_length=200)]] = Field(
    min_length=1, max_length=60)
