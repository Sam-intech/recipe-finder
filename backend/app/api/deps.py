"""Helpers shared by the route modules."""

from fastapi import Request

from app.config import settings


def client_ip(request: Request) -> str:
  """The user's IP, for the per-IP AI limit.

  Hosting providers put a proxy in front of the app, so the connecting address is the proxy's.
  Each trusted proxy appends the address it saw to X-Forwarded-For, so with N trusted hops the
  real client is the Nth entry from the right. Entries further left were sent by the client
  and can be faked, so they are never used.
  """
  hops = settings.trusted_proxy_hops
  if hops:
    forwarded = [part.strip() for part in request.headers.get("x-forwarded-for", "").split(",")]
    forwarded = [part for part in forwarded if part]
    if len(forwarded) >= hops:
      return forwarded[-hops]
  return request.client.host if request.client else "unknown"
