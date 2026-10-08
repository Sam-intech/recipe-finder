"""Recipe fetching and parsing. Plain functions, no web framework."""

import os
import re
from dataclasses import dataclass, field

import httpx
# ====================================================================================

API_KEY = os.environ.get("THEMEALDB_API_KEY", "1")  # "1" = dev/educational key only
BASE_URL = f"https://www.themealdb.com/api/json/v1/{API_KEY}"
MAX_INGREDIENT_SLOTS = 20

# Lines like "STEP 1" or "1." on their own are noise, not instructions.
_STEP_LABEL = re.compile(r"^(step\s*\d+|\d+[.)]?)$", re.IGNORECASE)
# ====================================================================================

@dataclass
class Ingredient:
  name: str
  measure: str


@dataclass
class Recipe:
  id: str
  name: str
  category: str
  area: str
  description: str
  steps: list[str]
  ingredients: list[Ingredient]
  thumbnail: str = ""
  source_url: str = ""
  youtube_url: str = ""
  page_url: str = field(default="")
  source: str = "database"  # "database" (TheMealDB) or "ai" (generated)


def normalise(name: str) -> str:
  return " ".join(name.lower().split())


def _clean(value) -> str:
  """The API uses null, "" and " " for empty slots. Normalise all to ""."""
  if value is None:
    return ""
  return " ".join(str(value).split())


def merge_duplicates(ingredients: list[Ingredient]) -> list[Ingredient]:
  """One row per exact (normalised) name. Measures are joined, never added up,
  because they are free text ("1 tbs", "Splash", "2 cloves minced")."""
  merged: dict[str, Ingredient] = {}
  measures: dict[str, list[str]] = {}
  for item in ingredients:
    key = normalise(item.name)
    if key not in merged:
      merged[key] = Ingredient(name=item.name, measure="")
      measures[key] = []
    if item.measure and item.measure not in measures[key]:
      measures[key].append(item.measure)
  for key, item in merged.items():
    item.measure = " + ".join(measures[key])
  return list(merged.values())


def parse_steps(instructions: str) -> list[str]:
  steps = []
  for line in instructions.replace("\r\n", "\n").split("\n"):
    line = line.strip()
    if line and not _STEP_LABEL.match(line):
      steps.append(line)
  return steps


def parse_ingredients(meal: dict) -> list[Ingredient]:
  ingredients = []
  for n in range(1, MAX_INGREDIENT_SLOTS + 1):
    name = _clean(meal.get(f"strIngredient{n}"))
    if not name:
      continue  # empty slot; a blank measure with a real name is still kept
    ingredients.append(Ingredient(name=name, measure=_clean(meal.get(f"strMeasure{n}"))))
  return merge_duplicates(ingredients)


def parse_meal(meal: dict) -> Recipe:
  category = _clean(meal.get("strCategory"))
  area = _clean(meal.get("strArea"))
  # TheMealDB has no description field, so we describe only what it actually gives us.
  parts = [p for p in (area, category) if p]
  description = " ".join(parts) + " recipe" if parts else "Recipe"
  meal_id = _clean(meal.get("idMeal"))
  return Recipe(
    id=meal_id,
    name=_clean(meal.get("strMeal")),
    category=category,
    area=area,
    description=description,
    steps=parse_steps(str(meal.get("strInstructions") or "")),
    ingredients=parse_ingredients(meal),
    thumbnail=_clean(meal.get("strMealThumb")),
    source_url=_clean(meal.get("strSource")),
    youtube_url=_clean(meal.get("strYoutube")),
    page_url=f"https://www.themealdb.com/meal/{meal_id}" if meal_id else "",
  )


def _get_meals(endpoint: str, params: dict) -> list[dict]:
  response = httpx.get(f"{BASE_URL}/{endpoint}", params=params, timeout=10.0)
  response.raise_for_status()
  # "meals" is null when nothing matches.
  return response.json().get("meals") or []


def search_recipes(query: str) -> list[Recipe]:
  query = query.strip()
  if not query:
    return []
  return [parse_meal(m) for m in _get_meals("search.php", {"s": query})]


def get_recipe(recipe_id: str) -> Recipe | None:
  meals = _get_meals("lookup.php", {"i": recipe_id})
  return parse_meal(meals[0]) if meals else None
