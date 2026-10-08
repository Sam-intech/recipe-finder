"""Protection for the paid AI endpoint: a cache, a per-IP limit and a daily cap.

Each layer covers a different failure:
- Cache: the same dish is never paid for twice (cost).
- Per-IP limit: one ordinary user can't hammer the button (fairness).
- Daily cap: a hard ceiling on total AI calls, however many IPs someone uses (the backstop).

Plain Python, no FastAPI imports, so it can be tested on its own.

Limitations, on purpose for now:
- Everything lives in memory. A server restart empties the cache and resets the counters.
- It assumes one server process. Two processes would each keep their own counts.
"""

import os
import threading
import time
from collections import OrderedDict, deque
from datetime import datetime, timezone

DAILY_CAP = int(os.environ.get("AI_DAILY_CAP", "20"))
PER_IP_LIMIT = int(os.environ.get("AI_PER_IP_LIMIT", "5"))
PER_IP_WINDOW_SECONDS = 60 * 60
CACHE_MAX_ENTRIES = 500

_MISSING = object()  # Lets the cache store None ("not a dish") as a real answer.


def normalise(query: str) -> str:
  """'  Jollof   RICE ' and 'jollof rice' should hit the same cache entry."""
  return " ".join(query.lower().split())


class LimitReached(Exception):
  """Raised when either limit blocks an AI call."""


class AIGuard:
  # FastAPI runs normal `def` endpoints in a thread pool, so two requests can touch these
  # counters at the same moment. The lock makes "check then count" happen as one step.

  def __init__(self, daily_cap=DAILY_CAP, per_ip_limit=PER_IP_LIMIT,
               window_seconds=PER_IP_WINDOW_SECONDS, clock=time.time):
    self.daily_cap = daily_cap
    self.per_ip_limit = per_ip_limit
    self.window_seconds = window_seconds
    self.clock = clock  # Injectable so tests can move time forward without waiting.
    self._lock = threading.Lock()
    self._cache = OrderedDict()
    self._calls_by_ip = {}
    self._day = None
    self._calls_today = 0

  def cached(self, query: str):
    """Return the stored answer, or _MISSING if this dish hasn't been generated yet."""
    with self._lock:
      return self._cache.get(normalise(query), _MISSING)

  def remember(self, query: str, recipe) -> None:
    with self._lock:
      self._cache[normalise(query)] = recipe
      if len(self._cache) > CACHE_MAX_ENTRIES:
        self._cache.popitem(last=False)  # Drop the oldest entry.

  def take_slot(self, ip: str) -> None:
    """Count one AI call for this IP, or raise LimitReached without counting it."""
    with self._lock:
      now = self.clock()
      today = datetime.fromtimestamp(now, timezone.utc).date()
      if today != self._day:
        self._day, self._calls_today = today, 0

      calls = self._calls_by_ip.setdefault(ip, deque())
      while calls and calls[0] <= now - self.window_seconds:
        calls.popleft()  # Forget calls older than the window.

      if self._calls_today >= self.daily_cap or len(calls) >= self.per_ip_limit:
        raise LimitReached()

      calls.append(now)
      self._calls_today += 1


MISSING = _MISSING
guard = AIGuard()
