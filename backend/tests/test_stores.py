import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import stores
from app.services.stores import StoreGuard, RateLimited
# =================================================================================================

client = TestClient(app)

# A point in Maidstone, UK. Any real coordinates would do.
LAT, LON = 51.2720, 0.5290


@pytest.fixture(autouse=True)
def fresh_guard(monkeypatch):
  # Each test gets its own cache and counters.
  monkeypatch.setattr(stores, "guard", StoreGuard(per_ip_limit=20))


def node(name, lat, lon, shop="supermarket", **extra):
  return {"type": "node", "lat": lat, "lon": lon, "tags": {"name": name, "shop": shop, **extra}}


ELEMENTS = [
  node("Far Supermarket", LAT + 0.03, LON),                      # about 3.3 km away
  node("Near Supermarket", LAT + 0.002, LON, **{
    "addr:housenumber": "12", "addr:street": "High Street", "addr:postcode": "ME14 1AA",
    "opening_hours": "Mo-Su 07:00-22:00"}),
  node("Mid Supermarket", LAT + 0.01, LON),
  node("Jones & Sons", LAT + 0.004, LON, shop="butcher"),
  node("The Fish Shop", LAT + 0.005, LON, shop="seafood"),
  node("Lagos Afro Foods", LAT + 0.006, LON, shop="convenience"),
  node("Corner Shop", LAT + 0.001, LON, shop="convenience"),    # plain convenience: not listed
  {"type": "node", "lat": LAT + 0.001, "lon": LON, "tags": {"shop": "supermarket"}},  # no name
  {"type": "way", "center": {"lat": LAT + 0.0015, "lon": LON},
   "tags": {"name": "Mapped As A Building", "shop": "supermarket"}},
]


def fake_fetch(query):
  fake_fetch.queries.append(query)
  return ELEMENTS


@pytest.fixture(autouse=True)
def reset_queries():
  fake_fetch.queries = []


# --- sorting ingredients into store types --------------------------------------------------------

@pytest.mark.parametrize("name,expected", [
  ("Chicken thighs", "butcher"),
  ("minced beef", "butcher"),
  ("Salmon fillets", "fishmonger"),
  ("King prawns", "fishmonger"),
  ("Garlic", "supermarket"),
  ("Chicken stock cube", "supermarket"),   # not the animal
  ("Fish sauce", "specialist"),            # checked before "fish"
  ("Egusi", "specialist"),
  ("Hamburger buns", "supermarket"),       # "ham" must not match inside a word
  ("Yoghurt", "supermarket"),              # "yam" must not match inside a word
  ("Ground crayfish", "specialist"),
])
def test_classify(name, expected):
  assert stores.classify(name) == expected


def test_group_items_puts_meat_under_both_butcher_and_supermarket():
  groups = stores.group_items(["Chicken thighs", "Garlic", "Egusi", "chicken thighs"])
  assert groups["supermarket"] == ["Chicken thighs", "Garlic"]   # duplicate removed
  assert groups["butcher"] == ["Chicken thighs"]
  assert groups["specialist"] == ["Egusi"]                       # not under supermarket
  assert groups["fishmonger"] == []


# --- the Overpass query --------------------------------------------------------------------------

def test_query_only_asks_for_needed_shop_types():
  query = stores.build_query(LAT, LON, {"butcher"}, 5000)
  assert '"shop"="butcher"' in query
  assert "supermarket" not in query
  assert "around:5000,51.27200,0.52900" in query
  assert query.startswith("[out:json]") and query.endswith("out center tags 300;")


def test_query_for_specialist_filters_by_name():
  query = stores.build_query(LAT, LON, {"specialist"}, 5000)
  assert '["name"~"' in query and ",i]" in query


# --- reading the answer --------------------------------------------------------------------------

def test_stores_are_sorted_nearest_first_and_unnamed_are_dropped():
  found = stores.stores_by_category(ELEMENTS, LAT, LON, {"supermarket"})["supermarket"]
  assert [s.name for s in found] == [
    "Mapped As A Building", "Near Supermarket", "Mid Supermarket", "Far Supermarket"]
  assert found[0].distance_m < found[1].distance_m < found[2].distance_m


def test_way_uses_its_center_point():
  found = stores.stores_by_category(ELEMENTS, LAT, LON, {"supermarket"})["supermarket"]
  assert found[0].lat == LAT + 0.0015


def test_address_and_hours_come_through():
  found = stores.stores_by_category(ELEMENTS, LAT, LON, {"supermarket"})["supermarket"]
  near = next(s for s in found if s.name == "Near Supermarket")
  assert near.address == "12 High Street, ME14 1AA"
  assert near.opening_hours == "Mo-Su 07:00-22:00"


def test_specialist_matched_by_name_only():
  found = stores.stores_by_category(ELEMENTS, LAT, LON, {"specialist"})["specialist"]
  assert [s.name for s in found] == ["Lagos Afro Foods"]   # "Corner Shop" has no keyword


def test_duplicates_are_removed():
  twice = ELEMENTS + [ELEMENTS[1]]
  found = stores.stores_by_category(twice, LAT, LON, {"supermarket"})["supermarket"]
  assert [s.name for s in found].count("Near Supermarket") == 1


def test_only_nearest_five_are_kept():
  many = [node(f"Shop {i}", LAT + 0.001 * (i + 1), LON) for i in range(8)]
  found = stores.stores_by_category(many, LAT, LON, {"supermarket"})["supermarket"]
  assert len(found) == 5 and found[0].name == "Shop 0"


def test_distance_is_sensible():
  # 0.01 degrees of latitude is about 1.11 km.
  assert 1100 < stores.distance_m(LAT, LON, LAT + 0.01, LON) < 1120


# --- the whole search ----------------------------------------------------------------------------

def test_find_stores_groups_results():
  result = stores.find_stores(LAT, LON, ["Chicken thighs", "Garlic", "Egusi"], "1.2.3.4",
                              fetch=fake_fetch)
  labels = [g["label"] for g in result["groups"]]
  assert labels == ["Supermarkets", "Butchers", "Specialist and world food shops"]
  butcher = result["groups"][1]
  assert butcher["items"] == ["Chicken thighs"] and butcher["stores"][0]["name"] == "Jones & Sons"
  assert len(fake_fetch.queries) == 1          # one query covers every shop type


def test_repeat_search_nearby_uses_the_cache():
  for lat in (LAT, LAT + 0.0001):              # about 11 m apart: same cache entry
    stores.find_stores(lat, LON, ["Garlic"], "1.2.3.4", fetch=fake_fetch)
  assert len(fake_fetch.queries) == 1


def test_distances_come_from_the_exact_position_even_when_cached():
  first = stores.find_stores(LAT, LON, ["Garlic"], "a", fetch=fake_fetch)
  second = stores.find_stores(LAT + 0.0004, LON, ["Garlic"], "b", fetch=fake_fetch)
  assert first["groups"][0]["stores"][0]["distance_m"] != second["groups"][0]["stores"][0]["distance_m"]


def test_per_ip_limit_counts_only_real_searches():
  guard = StoreGuard(per_ip_limit=2)
  for i in range(2):
    stores.find_stores(LAT + i, LON, ["Garlic"], "ip", fetch=fake_fetch, store_guard=guard)
  with pytest.raises(RateLimited):
    stores.find_stores(LAT + 5, LON, ["Garlic"], "ip", fetch=fake_fetch, store_guard=guard)
  # A cached search still works for the blocked IP, and a different IP is unaffected.
  stores.find_stores(LAT, LON, ["Garlic"], "ip", fetch=fake_fetch, store_guard=guard)
  stores.find_stores(LAT + 7, LON, ["Garlic"], "other", fetch=fake_fetch, store_guard=guard)


def test_limit_window_slides():
  now = [1_800_000_000.0]
  guard = StoreGuard(per_ip_limit=1, clock=lambda: now[0])
  stores.find_stores(LAT, LON, ["Garlic"], "ip", fetch=fake_fetch, store_guard=guard)
  with pytest.raises(RateLimited):
    stores.find_stores(LAT + 1, LON, ["Garlic"], "ip", fetch=fake_fetch, store_guard=guard)
  now[0] += 3601
  stores.find_stores(LAT + 1, LON, ["Garlic"], "ip", fetch=fake_fetch, store_guard=guard)


def test_cache_expires():
  now = [1_800_000_000.0]
  guard = StoreGuard(clock=lambda: now[0])
  stores.find_stores(LAT, LON, ["Garlic"], "ip", fetch=fake_fetch, store_guard=guard)
  now[0] += stores.CACHE_TTL_SECONDS + 1
  stores.find_stores(LAT, LON, ["Garlic"], "ip", fetch=fake_fetch, store_guard=guard)
  assert len(fake_fetch.queries) == 2


def test_failed_fetch_is_not_cached():
  def broken(query):
    raise httpx.ConnectError("down")
  with pytest.raises(httpx.HTTPError):
    stores.find_stores(LAT, LON, ["Garlic"], "ip", fetch=broken)
  stores.find_stores(LAT, LON, ["Garlic"], "ip", fetch=fake_fetch)
  assert len(fake_fetch.queries) == 1


# --- the HTTP endpoint ---------------------------------------------------------------------------

BODY = {"lat": LAT, "lon": LON, "items": ["Chicken thighs", "Garlic"]}


def test_endpoint_returns_groups(monkeypatch):
  monkeypatch.setattr(stores, "fetch_overpass", fake_fetch)
  response = client.post("/api/stores", json=BODY)
  assert response.status_code == 200
  data = response.json()
  assert [g["category"] for g in data["groups"]] == ["supermarket", "butcher"]
  assert data["radius_m"] == 5000 and "OpenStreetMap" in data["attribution"]


def test_endpoint_overpass_failure_is_502_without_details(monkeypatch):
  def broken(query):
    raise httpx.ReadTimeout("secret internal detail")
  monkeypatch.setattr(stores, "fetch_overpass", broken)
  response = client.post("/api/stores", json=BODY)
  assert response.status_code == 502
  assert "secret" not in response.text


def test_endpoint_rate_limit_is_429(monkeypatch):
  monkeypatch.setattr(stores, "fetch_overpass", fake_fetch)
  monkeypatch.setattr(stores, "guard", StoreGuard(per_ip_limit=1))
  assert client.post("/api/stores", json=BODY).status_code == 200
  assert client.post("/api/stores", json={**BODY, "lat": LAT + 1}).status_code == 429


@pytest.mark.parametrize("bad", [
  {"lat": 91, "lon": 0, "items": ["Garlic"]},
  {"lat": 0, "lon": 181, "items": ["Garlic"]},
  {"lat": "north", "lon": 0, "items": ["Garlic"]},
  {"lat": 0, "lon": 0, "items": []},
  {"lat": 0, "lon": 0, "items": [""]},
  {"lat": 0, "lon": 0, "items": ["x"] * 61},
  {"lon": 0, "items": ["Garlic"]},
])
def test_endpoint_validates_input(bad):
  assert client.post("/api/stores", json=bad).status_code == 422


def test_location_is_not_in_the_url():
  # GET must not exist: coordinates in a URL end up in logs.
  assert client.get(f"/api/stores?lat={LAT}&lon={LON}").status_code == 405
