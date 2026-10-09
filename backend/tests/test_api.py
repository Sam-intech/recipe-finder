import httpx
import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from app.services import ai_recipes, limits, recipes
from app.services.recipes import Ingredient, Recipe
from app.api.deps import client_ip
from app.config import settings
from app.main import app
# =================================================================================================

client = TestClient(app)


@pytest.fixture(autouse=True)
def fresh_guard(monkeypatch):
  # Each test gets its own cache and counters, so tests can't leak into each other.
  monkeypatch.setattr(limits, "guard", limits.AIGuard(daily_cap=20, per_ip_limit=5))

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
  if endpoint == "lookup.php":
    return [MEAL] if params["i"] == MEAL["idMeal"] else []
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


def test_health():
  assert client.get("/health").json() == {"status": "ok"}


def test_cors_allows_configured_origin_only():
  allowed = settings.cors_origins[0]
  ok = client.get("/health", headers={"Origin": allowed})
  assert ok.headers["access-control-allow-origin"] == allowed
  blocked = client.get("/health", headers={"Origin": "https://evil.example"})
  assert "access-control-allow-origin" not in blocked.headers


def fake_request(peer, forwarded=None):
  headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
  return Request({"type": "http", "headers": headers, "client": (peer, 1234)})


def test_client_ip_ignores_forwarded_header_by_default(monkeypatch):
  monkeypatch.setattr(settings, "trusted_proxy_hops", 0)
  assert client_ip(fake_request("10.0.0.1", "6.6.6.6")) == "10.0.0.1"


def test_client_ip_takes_the_entry_the_trusted_proxy_added(monkeypatch):
  monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
  # The client faked "6.6.6.6"; the proxy appended the real address on the right.
  assert client_ip(fake_request("10.0.0.1", "6.6.6.6, 203.0.113.7")) == "203.0.113.7"
  assert client_ip(fake_request("10.0.0.1")) == "10.0.0.1"


# --- AI protection -------------------------------------------------------------------------------

def counting_generator(monkeypatch):
  calls = []
  def fake(q):
    calls.append(q)
    return ai_recipe()
  monkeypatch.setattr(ai_recipes, "generate_recipe", fake)
  return calls


def test_repeat_dish_is_served_from_cache(monkeypatch):
  calls = counting_generator(monkeypatch)
  for q in ["Jollof Rice", "jollof rice", "  JOLLOF   rice "]:
    assert client.post("/api/recipes/generate", json={"q": q}).status_code == 200
  assert len(calls) == 1


def test_per_ip_limit_returns_tired_message(monkeypatch):
  counting_generator(monkeypatch)
  for i in range(5):
    assert client.post("/api/recipes/generate", json={"q": f"dish {i}"}).status_code == 200
  response = client.post("/api/recipes/generate", json={"q": "dish 6"})
  assert response.status_code == 429
  assert "tired" in response.json()["detail"]


def test_cache_hits_still_work_after_limit(monkeypatch):
  counting_generator(monkeypatch)
  for i in range(5):
    client.post("/api/recipes/generate", json={"q": f"dish {i}"})
  assert client.post("/api/recipes/generate", json={"q": "dish 0"}).status_code == 200


def test_ai_failure_is_not_cached(monkeypatch):
  def failed(q):
    raise ai_recipes.AIRecipeError("boom")
  monkeypatch.setattr(ai_recipes, "generate_recipe", failed)
  assert client.post("/api/recipes/generate", json={"q": "pho"}).status_code == 502
  calls = counting_generator(monkeypatch)
  assert client.post("/api/recipes/generate", json={"q": "pho"}).status_code == 200
  assert len(calls) == 1


# --- Polishing database recipes ------------------------------------------------------------------

def counting_polisher(monkeypatch):
  calls = []
  def fake(original):
    calls.append(original.id)
    return Recipe(**{**original.__dict__, "steps": ["Tidy step."], "source": "polished"})
  monkeypatch.setattr(ai_recipes, "polish_recipe", fake)
  monkeypatch.setattr(recipes, "_get_meals", fake_get_meals)
  return calls


def test_polish_success_is_cached(monkeypatch):
  calls = counting_polisher(monkeypatch)
  for _ in range(2):
    body = client.post("/api/recipes/polish", json={"id": "52771"}).json()
    assert body["recipe"]["source"] == "polished"
    assert body["recipe"]["steps"] == ["Tidy step."]
  assert calls == ["52771"]


def test_polish_unknown_id_is_404_and_spends_no_slot(monkeypatch):
  calls = counting_polisher(monkeypatch)
  assert client.post("/api/recipes/polish", json={"id": "999"}).status_code == 404
  assert calls == []
  assert limits.guard._calls_today == 0


def test_polish_rejects_non_numeric_id():
  assert client.post("/api/recipes/polish", json={"id": "ai-jollof"}).status_code == 422


def test_polish_and_generate_share_the_limits(monkeypatch):
  counting_polisher(monkeypatch)
  counting_generator(monkeypatch)
  for i in range(5):
    assert client.post("/api/recipes/generate", json={"q": f"dish {i}"}).status_code == 200
  assert client.post("/api/recipes/polish", json={"id": "52771"}).status_code == 429


def test_polish_failure_is_502(monkeypatch):
  monkeypatch.setattr(recipes, "_get_meals", fake_get_meals)
  def failed(original):
    raise ai_recipes.AIRecipeError("boom")
  monkeypatch.setattr(ai_recipes, "polish_recipe", failed)
  assert client.post("/api/recipes/polish", json={"id": "52771"}).status_code == 502
