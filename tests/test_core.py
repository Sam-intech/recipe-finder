from app.core.recipes import Ingredient, merge_duplicates, parse_ingredients, parse_meal, parse_steps
from app.core.shopping import build_shopping_list, to_csv, to_markdown
# =================================================================================================

MEAL = {
  "idMeal": "1",
  "strMeal": "Test Dish",
  "strCategory": "Chicken",
  "strArea": "Lebanese",
  "strInstructions": "STEP 1\r\nMix the spices.\r\n\r\n2.\r\nGrill the chicken.\r\n",
  "strIngredient1": "Chicken Thighs",
  "strMeasure1": "500g",
  "strIngredient2": "Sumac",
  "strMeasure2": " ",
  "strIngredient3": "",
  "strMeasure3": "",
  "strIngredient4": None,
  "strMeasure4": None,
}
# ================================================================================================


def test_parse_ingredients_skips_empty_slots_and_keeps_blank_measures():
  items = parse_ingredients(MEAL)
  assert [i.name for i in items] == ["Chicken Thighs", "Sumac"]
  assert items[1].measure == ""


def test_parse_steps_drops_step_labels_and_blank_lines():
  assert parse_steps(MEAL["strInstructions"]) == ["Mix the spices.", "Grill the chicken."]


def test_parse_meal_keeps_steps_on_separate_lines():
  # Regression: whitespace cleaning must not flatten the instructions into one line.
  assert len(parse_meal(MEAL).steps) == 2


def test_parse_meal_builds_description_from_real_fields_only():
  recipe = parse_meal(MEAL)
  assert recipe.description == "Lebanese Chicken recipe"
  assert recipe.page_url == "https://www.themealdb.com/meal/1"
  assert recipe.source == "database"


def test_merge_duplicates_joins_measures_in_order():
  merged = merge_duplicates([
    Ingredient("Cumin", "1 tbs"),
    Ingredient("Lemon Juice", "2 tbs"),
    Ingredient("cumin ", "1 tsp"),
    Ingredient("Lemon Juice", "Splash"),
  ])
  assert [(i.name, i.measure) for i in merged] == [("Cumin", "1 tbs + 1 tsp"), ("Lemon Juice", "2 tbs + Splash")]


def test_merge_duplicates_skips_blank_and_repeated_measures():
  merged = merge_duplicates([Ingredient("Salt", ""), Ingredient("Salt", "Splash"), Ingredient("Salt", "Splash")])
  assert merged[0].measure == "Splash"


def test_merge_does_not_fuzzy_match_variants():
  names = [i.name for i in merge_duplicates([Ingredient("Paprika", "1 tsp"), Ingredient("Smoked Paprika", "1 tsp")])]
  assert names == ["Paprika", "Smoked Paprika"]


def test_parse_collapses_double_spaces_in_measures():
  meal = {**MEAL, "strMeasure1": "3  tablespoons"}
  assert parse_ingredients(meal)[0].measure == "3 tablespoons"


def test_shopping_list_removes_owned_case_insensitively():
  items = parse_meal(MEAL).ingredients
  assert [i.name for i in build_shopping_list(items, ["  chicken thighs "])] == ["Sumac"]


def test_shopping_list_with_nothing_owned_returns_everything():
  assert len(build_shopping_list(parse_meal(MEAL).ingredients, [])) == 2


def test_exports():
  items = parse_meal(MEAL).ingredients
  assert "Chicken Thighs,500g,Test Dish" in to_csv("Test Dish", items)
  md = to_markdown("Test Dish", items)
  assert "- [ ] Chicken Thighs (500g)" in md
  assert "- [ ] Sumac\n" in md


def test_csv_neutralises_spreadsheet_formulas():
  out = to_csv("Dish", [Ingredient("=HYPERLINK(\"http://evil\")", "+1")])
  assert "'=HYPERLINK" in out
  assert "'+1" in out
