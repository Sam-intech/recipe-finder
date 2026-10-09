"""Find nearby shops for a shopping list, using OpenStreetMap data through the Overpass API.

Plain Python, no FastAPI imports, so it can be tested on its own. The network call is passed in
as `fetch`, which is how the tests run without internet.

How it works:
1. Each ingredient is sorted into a store type: supermarket, butcher, fishmonger or specialist.
2. One Overpass query fetches every shop type we need around the user.
3. Shops are matched, sorted by distance and trimmed to the nearest few per type.

Honest limits, on purpose:
- We can't know what a shop has in stock. Results say where an item is *likely* sold.
- OpenStreetMap is volunteer-mapped. Coverage and opening hours vary by area.
- "Specialist" shops are found by name keywords, because OpenStreetMap has no tag for
  "African grocer" or "Asian supermarket". Treat that group as a lead, not a promise.
- The cache and the limits live in memory and reset on restart, like the AI guard.
"""

import math
import re
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, asdict

import httpx

from app.config import settings
# ====================================================================================

LABELS = {
  "supermarket": "Supermarkets",
  "butcher": "Butchers",
  "fishmonger": "Fishmongers",
  "specialist": "Specialist and world food shops",
}
NOTES = {
  "supermarket": "",
  "butcher": "Most supermarkets sell these too.",
  "fishmonger": "Most supermarkets sell these too.",
  "specialist": "Found by shop name, so check they stock what you need before you go.",
}
ORDER = ["supermarket", "butcher", "fishmonger", "specialist"]
PER_CATEGORY = 5

# A starter list. Add words as you find items that end up in the wrong group.
_SPECIALIST_ITEMS = [
  "sumac", "za'atar", "zaatar", "gochujang", "egusi", "ogbono", "gari", "garri", "fufu",
  "yam", "cassava", "pandan", "galangal", "kaffir lime", "pomegranate molasses",
  "ras el hanout", "dashi", "berbere", "suya", "iru", "locust bean", "ground crayfish",
  "palm oil", "bitter leaf", "ugu", "tamarind", "fish sauce",
]
_MEAT = ["chicken", "beef", "lamb", "pork", "mince", "minced", "steak", "sausage", "bacon",
         "turkey", "duck", "goat", "ham", "ribs", "brisket", "veal", "gammon", "oxtail", "mutton"]
_FISH = ["fish", "salmon", "cod", "haddock", "tuna", "prawn", "shrimp", "mackerel", "sardine",
         "anchovy", "anchovies", "crab", "lobster", "mussel", "squid", "trout", "sea bass",
         "tilapia", "catfish"]
# "chicken stock" and "beef seasoning" are not meat. Checked before the meat and fish words.
_NOT_THE_ANIMAL = re.compile(
  r"\b(stock|broth|bouillon|cubes?|sauce|powder|seasoning|paste|flavou?red|flavou?ring|gravy)\b")


def _words(words: list[str]) -> re.Pattern:
  # \b stops "ham" matching inside "hamburger"; s? allows plurals like "prawns".
  return re.compile(r"\b(?:" + "|".join(re.escape(w) for w in words) + r")s?\b")


_SPECIALIST_RE = _words(_SPECIALIST_ITEMS)
_MEAT_RE = _words(_MEAT)
_FISH_RE = _words(_FISH)

# Shop names that suggest a specialist or world food shop.
_SPECIALIST_SHOP_NAMES = (
  "asian|oriental|chinese|japanese|korean|thai|indian|african|afro|caribbean|halal|"
  "international|middle eastern|turkish|polish|continental|spice"
)
_SPECIALIST_SHOP_RE = re.compile(_SPECIALIST_SHOP_NAMES, re.IGNORECASE)
_SPECIALIST_SHOP_TYPES = {"supermarket", "convenience", "greengrocer"}
# ====================================================================================


def normalise(name: str) -> str:
  return " ".join(name.lower().split())


def classify(ingredient: str) -> str:
  """The one store type an ingredient is best matched to."""
  name = normalise(ingredient)
  if _SPECIALIST_RE.search(name):
    return "specialist"
  if _NOT_THE_ANIMAL.search(name):
    return "supermarket"
  if _MEAT_RE.search(name):
    return "butcher"
  if _FISH_RE.search(name):
    return "fishmonger"
  return "supermarket"


def group_items(ingredients: list[str]) -> dict[str, list[str]]:
  """Items per store type. Meat and fish also appear under supermarkets, because that's where
  most people buy them. Specialist items don't, since most supermarkets won't have them."""
  groups = {category: [] for category in ORDER}
  seen = set()
  for name in ingredients:
    key = normalise(name)
    if not key or key in seen:
      continue
    seen.add(key)
    category = classify(name)
    if category != "specialist":
      groups["supermarket"].append(name)
    if category != "supermarket":
      groups[category].append(name)
  return groups


def build_query(lat: float, lon: float, categories: set[str], radius_m: int) -> str:
  """Overpass QL: one query for every shop type needed. `out center` gives shops mapped as
  buildings (ways) a single point as well."""
  around = f"(around:{radius_m},{lat:.5f},{lon:.5f})"
  parts = []
  if "supermarket" in categories:
    parts.append(f'nwr["shop"="supermarket"]{around};')
  if "butcher" in categories:
    parts.append(f'nwr["shop"="butcher"]{around};')
  if "fishmonger" in categories:
    parts.append(f'nwr["shop"="seafood"]{around};')
  if "specialist" in categories:
    types = "|".join(sorted(_SPECIALIST_SHOP_TYPES))
    parts.append(f'nwr["shop"~"^({types})$"]["name"~"{_SPECIALIST_SHOP_NAMES}",i]{around};')
  return "[out:json][timeout:20];(" + "".join(parts) + ");out center tags 300;"


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
  """Straight-line distance in metres (haversine). Not walking distance."""
  radius = 6371000
  p1, p2 = math.radians(lat1), math.radians(lat2)
  dp, dl = p2 - p1, math.radians(lon2 - lon1)
  a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
  return 2 * radius * math.asin(math.sqrt(a))


@dataclass
class Store:
  name: str
  distance_m: int
  lat: float
  lon: float
  address: str
  opening_hours: str  # OpenStreetMap's own text, e.g. "Mo-Sa 08:00-20:00". May be out of date.


def _categories_of(tags: dict) -> set[str]:
  shop = tags.get("shop", "")
  found = set()
  if shop == "supermarket":
    found.add("supermarket")
  elif shop == "butcher":
    found.add("butcher")
  elif shop == "seafood":
    found.add("fishmonger")
  if shop in _SPECIALIST_SHOP_TYPES and _SPECIALIST_SHOP_RE.search(tags.get("name", "")):
    found.add("specialist")
  return found


def _address(tags: dict) -> str:
  street = " ".join(p for p in (tags.get("addr:housenumber"), tags.get("addr:street")) if p)
  place = " ".join(p for p in (tags.get("addr:city"), tags.get("addr:postcode")) if p)
  return ", ".join(p for p in (street, place) if p)


def stores_by_category(elements: list[dict], lat: float, lon: float,
                       wanted: set[str]) -> dict[str, list[Store]]:
  """Turn raw Overpass elements into the nearest few named shops per store type."""
  found = {category: [] for category in wanted}
  seen = set()
  for element in elements:
    tags = element.get("tags") or {}
    name = tags.get("name")
    point = element.get("center") or element  # nodes carry lat/lon, ways carry a center
    plat, plon = point.get("lat"), point.get("lon")
    if not name or plat is None or plon is None:
      continue  # a shop with no name or position can't be shown usefully
    for category in _categories_of(tags) & wanted:
      key = (category, normalise(name), round(plat, 4), round(plon, 4))
      if key in seen:
        continue
      seen.add(key)
      found[category].append(Store(
        name=name,
        distance_m=round(distance_m(lat, lon, plat, plon)),
        lat=plat,
        lon=plon,
        address=_address(tags),
        opening_hours=tags.get("opening_hours", ""),
      ))
  for category in found:
    found[category].sort(key=lambda s: s.distance_m)
    del found[category][PER_CATEGORY:]
  return found
# ====================================================================================


class RateLimited(Exception):
  """Raised when one IP has searched too often."""


_MISSING = object()
CACHE_MAX_ENTRIES = 200
CACHE_TTL_SECONDS = 6 * 60 * 60
WINDOW_SECONDS = 60 * 60


class StoreGuard:
  """A cache and a per-IP limit, so the free shared Overpass service isn't hammered.
  The lock matters: FastAPI runs these endpoints in threads, so two requests can arrive at
  once and "check then count" must happen as one step."""

  def __init__(self, per_ip_limit=20, clock=time.time):
    self.per_ip_limit = per_ip_limit
    self.clock = clock  # Injectable so tests can move time forward.
    self._lock = threading.Lock()
    self._cache = OrderedDict()  # key -> (stored_at, elements)
    self._calls_by_ip = {}

  def cached(self, key):
    with self._lock:
      entry = self._cache.get(key)
      if entry is None or self.clock() - entry[0] > CACHE_TTL_SECONDS:
        return _MISSING
      return entry[1]

  def remember(self, key, elements) -> None:
    with self._lock:
      self._cache[key] = (self.clock(), elements)
      self._cache.move_to_end(key)
      if len(self._cache) > CACHE_MAX_ENTRIES:
        self._cache.popitem(last=False)

  def take_slot(self, ip: str) -> None:
    with self._lock:
      now = self.clock()
      calls = self._calls_by_ip.setdefault(ip, deque())
      while calls and calls[0] <= now - WINDOW_SECONDS:
        calls.popleft()
      if len(calls) >= self.per_ip_limit:
        raise RateLimited()
      calls.append(now)


MISSING = _MISSING
guard = StoreGuard(per_ip_limit=settings.store_per_ip_limit)


def fetch_overpass(query: str) -> list[dict]:
  """The one real network call. Raises httpx.HTTPError when Overpass is busy or down."""
  response = httpx.post(
    settings.overpass_url,
    data={"data": query},
    headers={"User-Agent": settings.overpass_user_agent},
    timeout=25.0,
  )
  response.raise_for_status()
  return response.json().get("elements", [])


def find_stores(lat: float, lon: float, ingredients: list[str], ip: str,
                fetch=None, store_guard=None) -> dict:
  """Groups of nearby shops, one per store type that the list needs."""
  fetch = fetch or fetch_overpass
  store_guard = store_guard or guard
  items = group_items(ingredients)
  wanted = {category for category, names in items.items() if names}
  radius = settings.store_radius_m
  if wanted:
    # The search is centred on a point rounded to about 100 m, so nearby users share cache
    # entries. Distances are still measured from the exact position.
    centre = (round(lat, 3), round(lon, 3))
    key = (*centre, radius, frozenset(wanted))
    elements = store_guard.cached(key)
    if elements is MISSING:
      store_guard.take_slot(ip)  # only a real Overpass call spends a slot
      elements = fetch(build_query(centre[0], centre[1], wanted, radius))
      store_guard.remember(key, elements)
    stores = stores_by_category(elements, lat, lon, wanted)
  else:
    stores = {}
  groups = [
    {
      "category": category,
      "label": LABELS[category],
      "note": NOTES[category],
      "items": items[category],
      "stores": [asdict(s) for s in stores.get(category, [])],
    }
    for category in ORDER if items[category]
  ]
  return {"radius_m": radius, "groups": groups}
