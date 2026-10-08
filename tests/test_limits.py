import pytest

from app.core.limits import AIGuard, LimitReached, MISSING
# =================================================================================================


class Clock:
  def __init__(self):
    self.now = 1_800_000_000.0  # A fixed moment, so tests don't depend on the real time.
  def __call__(self):
    return self.now


def test_three_ips_cannot_pass_the_daily_cap():
  # The scenario from our discussion: 5 per IP per hour, 3 IPs = 15, but the cap still wins.
  guard = AIGuard(daily_cap=12, per_ip_limit=5, clock=Clock())
  taken = 0
  for ip in ["home", "mobile", "vpn"]:
    for _ in range(5):
      try:
        guard.take_slot(ip)
        taken += 1
      except LimitReached:
        pass
  assert taken == 12


def test_per_ip_window_slides():
  clock = Clock()
  guard = AIGuard(daily_cap=100, per_ip_limit=2, window_seconds=3600, clock=clock)
  guard.take_slot("a")
  guard.take_slot("a")
  with pytest.raises(LimitReached):
    guard.take_slot("a")
  guard.take_slot("b")  # Another IP is unaffected.
  clock.now += 3601
  guard.take_slot("a")  # Old calls have left the window.


def test_daily_cap_resets_next_day():
  clock = Clock()
  guard = AIGuard(daily_cap=1, per_ip_limit=100, clock=clock)
  guard.take_slot("a")
  with pytest.raises(LimitReached):
    guard.take_slot("a")
  clock.now += 24 * 3600
  guard.take_slot("a")


def test_blocked_call_is_not_counted():
  guard = AIGuard(daily_cap=1, per_ip_limit=1, clock=Clock())
  guard.take_slot("a")
  for _ in range(3):
    with pytest.raises(LimitReached):
      guard.take_slot("b")
  assert guard._calls_today == 1


def test_cache_stores_not_a_dish():
  guard = AIGuard()
  assert guard.cached("rock") is MISSING
  guard.remember("rock", None)
  assert guard.cached(" ROCK ") is None
