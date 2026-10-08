"""Shopping list logic and export formats."""

import csv
import io

from app.services.recipes import Ingredient, normalise
# =================================================================================


def build_shopping_list(ingredients: list[Ingredient], have: list[str]) -> list[Ingredient]:
  """Ingredients the user did NOT tick as already owned. Exact name match only (case and
  spacing ignored). Fuzzy matching is deliberately left out: wrongly saying "you have it"
  costs the user more than wrongly saying "you need it"."""
  owned = {normalise(n) for n in have}
  return [i for i in ingredients if normalise(i.name) not in owned]


def to_csv(recipe_name: str, items: list[Ingredient]) -> str:
  buffer = io.StringIO()
  writer = csv.writer(buffer)
  writer.writerow(["Ingredient", "Amount", "Recipe"])
  for item in items:
    writer.writerow([_csv_safe(item.name), _csv_safe(item.measure), _csv_safe(recipe_name)])
  return buffer.getvalue()


def _csv_safe(value: str) -> str:
  """Spreadsheets run text starting with = + - @ as a formula. Recipe text can come from
  an AI or a crowd-sourced database, so neutralise it before it lands in a CSV."""
  if value and value[0] in "=+-@\t\r":
    return "'" + value
  return value


def to_markdown(recipe_name: str, items: list[Ingredient]) -> str:
  lines = [f"# Shopping list: {recipe_name}", ""]
  for item in items:
    amount = f" ({item.measure})" if item.measure else ""
    lines.append(f"- [ ] {item.name}{amount}")
  return "\n".join(lines) + "\n"
