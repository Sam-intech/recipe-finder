import httpx
from fastapi.testclient import TestClient

from app.core import ai_recipes, recipes
from app.core.recipes import Ingredient, Recipe
from app.main import app
# =================================================================================================

client = TestClient(app)

MEAL = {
  "idMeal": "52771",
  "strMeal": "Spicy Arrabiata Penne",
  "strCategory": "Vegetarian",
  "strArea": "Italian",
  "strInstructions": "Boil the pasta.\r\nMake the sauce.",
  "strIngredient1": "Penne Rigate",
  "strMeasure1": "1 pound",
  "strIngredient2": "Garlic",
  "strMeasure2": "3 cloves",
  "strIngredient3": "",
}

LIST_BODY = {
  "recipe_name": "Spicy Arrabiata Penne",
  "ingredients": [
    {"name": "Penne Rigate", "measure": "1 pound"},
    {"name": "Garlic", "measure": "3 cloves"},
  ],
  "have": [],
}
# =================================================================================================

def fake_get_meals(endpoint, params):
  if endpoint == "search.php":
    return [MEAL] if params["s"].lower() == "arrabiata" else []
  raise AssertionError(endpoint)


def test_search_found(monkeypatch):
  monkeypatch.setattr(recipes, "_get_meals", fake_get_meals)
  body = client.get("/api/recipes", params={"q": "Arrabiata"}).json()
  assert body["results"][0]["name"] == "Spicy Arrabiata Penne"
  assert body["results"][0]["source"] == "database"


def test_search_not_found_is_empty_not_error(monkeypatch):
  monkeypatch.setattr(recipes, "_get_meals", fake_get_meals)
  assert client.get("/api/recipes", params={"q": "nope"}).json()["results"] == []


def test_search_requires_query():
  assert client.get("/api/recipes").status_code == 422


def test_upstream_failure_is_502_not_500(monkeypatch):
  def boom(endpoint, params):
    raise httpx.ConnectError("down")
  monkeypatch.setattr(recipes, "_get_meals", boom)
  assert client.get("/api/recipes", params={"q": "x"}).status_code == 502


def test_shopping_list_is_stateless_and_subtracts_owned():
  body = client.post("/api/shopping-list", json={**LIST_BODY, "have": ["garlic"]}).json()
  assert [i["name"] for i in body["items"]] == ["Penne Rigate"]


def test_shopping_list_merges_duplicates_sent_by_client():
  body = {**LIST_BODY, "ingredients": LIST_BODY["ingredients"] + [{"name": "garlic", "measure": "1 tsp"}]}
  items = client.post("/api/shopping-list", json=body).json()["items"]
  assert [(i["name"], i["measure"]) for i in items] == [("Penne Rigate", "1 pound"), ("Garlic", "3 cloves + 1 tsp")]


def test_shopping_list_rejects_bad_input():
  assert client.post("/api/shopping-list", json={**LIST_BODY, "recipe_name": ""}).status_code == 422
  too_many = [{"name": f"i{n}", "measure": ""} for n in range(61)]
  assert client.post("/api/shopping-list", json={**LIST_BODY, "ingredients": too_many}).status_code == 422
  assert client.post("/api/shopping-list", json={**LIST_BODY, "ingredients": [{"name": ""}]}).status_code == 422


def test_export_csv_and_md():
  csv_response = client.post("/api/shopping-list/export?format=csv", json=LIST_BODY)
  assert "attachment" in csv_response.headers["content-disposition"]
  assert "Garlic,3 cloves" in csv_response.text
  md_response = client.post("/api/shopping-list/export?format=md", json={**LIST_BODY, "have": ["garlic"]})
  assert "- [ ] Penne Rigate (1 pound)" in md_response.text
  assert "Garlic" not in md_response.text


def test_export_rejects_unknown_format():
  assert client.post("/api/shopping-list/export?format=pdf", json=LIST_BODY).status_code == 422


def ai_recipe():
  return Recipe(
    id="ai-jollof-rice", name="Jollof Rice", category="", area="Nigerian",
    description="Rice dish.", steps=["Cook."], ingredients=[Ingredient("Rice", "400 g")], source="ai",
  )


def test_generate_success(monkeypatch):
  monkeypatch.setattr(ai_recipes, "generate_recipe", lambda q: ai_recipe())
  body = client.post("/api/recipes/generate", json={"q": "jollof rice"}).json()
  assert body["recipe"]["source"] == "ai"
  assert body["recipe"]["name"] == "Jollof Rice"


def test_generate_not_a_dish_is_422(monkeypatch):
  monkeypatch.setattr(ai_recipes, "generate_recipe", lambda q: None)
  assert client.post("/api/recipes/generate", json={"q": "asdf"}).status_code == 422


def test_generate_not_configured_is_503(monkeypatch):
  def not_configured(q):
    raise ai_recipes.AINotConfigured("no key")
  monkeypatch.setattr(ai_recipes, "generate_recipe", not_configured)
  assert client.post("/api/recipes/generate", json={"q": "x"}).status_code == 503


def test_generate_failure_is_502_without_leaking_details(monkeypatch):
  def failed(q):
    raise ai_recipes.AIRecipeError("secret internal detail")
  monkeypatch.setattr(ai_recipes, "generate_recipe", failed)
  response = client.post("/api/recipes/generate", json={"q": "x"})
  assert response.status_code == 502
  assert "secret" not in response.text


def test_generate_validates_input():
  assert client.post("/api/recipes/generate", json={"q": ""}).status_code == 422
  assert client.post("/api/recipes/generate", json={"q": "x" * 101}).status_code == 422


def test_index_page_served():
  response = client.get("/")
  assert response.status_code == 200
  assert "Recipe Finder" in response.text
