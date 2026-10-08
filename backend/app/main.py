"""App entry point: builds the FastAPI app and wires in middleware and routes.

This is an API only. The React frontend is built and hosted separately and calls it over
HTTPS, which is why CORS is configured here.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import recipes, shopping
from app.config import settings


def create_app() -> FastAPI:
  app = FastAPI(title="Recipe Finder API")
  app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
  )
  app.include_router(recipes.router)
  app.include_router(shopping.router)

  @app.get("/health", tags=["meta"])
  def health():
    # For the host's health checks. Deliberately touches no external service.
    return {"status": "ok"}

  return app


app = create_app()
