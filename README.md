# Recipe Finder

Dish name in, recipe out, tick what you already have, get the list of what to buy, download it.

Recipes come from TheMealDB first. If there is no match, an AI model writes one automatically
(the user is told nothing was in the database), clearly labelled as AI-generated. Users can also
click "none of these" to get an AI recipe. Database recipes are rewritten by the AI before they
are shown, so the steps and quantities read clearly; if that fails, the original is shown instead.
Both AI paths share the same cache, per-IP limit and daily cap.
No location, shops or prices yet (stages 2 and 3).

## Repository layout

The frontend and backend are separate apps, deployed separately.

```
backend/                 FastAPI JSON API (Python 3.12)
  app/
    main.py              builds the app: CORS, routes, /health
    config.py            every setting, read from env vars (or backend/.env locally)
    api/                 HTTP layer: routes, request schemas, client IP helper
    services/            the logic, no web framework:
      recipes.py           fetch + parse TheMealDB, merge duplicate ingredient rows
      ai_recipes.py        Gemini: write recipes and polish database ones, validate everything
      limits.py            AI cache, per-IP limit, daily cap
      shopping.py          shopping list + CSV/markdown export
  tests/                 unit tests; the network and the AI client are faked
  Dockerfile             production image
  .env.example           settings template
frontend/                React + Vite + Tailwind, built to a static site in dist/
  src/api.js             every call to the backend goes through here
  .env.example           VITE_API_BASE_URL template
```

## Run locally

Two terminals, one per app.

**Backend** (http://127.0.0.1:8000, interactive docs at /docs):

    cd backend
    python3.12 -m venv .venv
    . .venv/bin/activate
    pip install -r requirements-dev.txt
    cp .env.example .env          # then put your GEMINI_API_KEY in .env
    python -m pytest -q           # offline tests, no network or keys needed
    uvicorn app.main:app --reload

**Frontend** (http://localhost:5173):

    cd frontend
    npm install
    npm run dev

In development the frontend calls `/api/...` and Vite forwards it to the backend on :8000, so no
frontend `.env` is needed.

## Settings

Backend (env vars; locally in `backend/.env`, in production in the host's dashboard):

- `GEMINI_API_KEY`: enables the AI features. Without it they return a clear "not set up" error.
- `CORS_ORIGINS`: comma-separated frontend URLs allowed to call the API. Default `http://localhost:5173`.
- `GEMINI_MODEL`: default `gemini-3.5-flash-lite`. Model names change often; check Google's current list.
- `THEMEALDB_API_KEY`: default `1`, the dev/educational key. A public app needs a paid key.
- `AI_DAILY_CAP`: total AI calls per day (UTC), default 20. Cached answers don't count.
- `AI_PER_IP_LIMIT`: AI calls per IP per hour, default 5.
- `OVERPASS_USER_AGENT`: who is calling the free OpenStreetMap search service. Put a contact in
  it, e.g. `recipe-finder (you@example.com)`. `OVERPASS_URL`, `STORE_RADIUS_M` (default 5000) and
  `STORE_PER_IP_LIMIT` (searches per IP per hour, default 20) are optional.
- `TRUSTED_PROXY_HOPS`: how many proxies in front of the API add to `X-Forwarded-For`. Default 0
  (use the connecting address). Behind a host's load balancer this is usually 1; check your
  host's docs. Wrong values make the per-IP limit count the proxy, or trust a faked address.

Frontend (build time only, all public):

- `VITE_API_BASE_URL`: the deployed API's URL, e.g. `https://api.example.com`. Empty in development.

## Deploying

**Backend:** any host that runs a Docker image, from `backend/` (Cloud Run, Render, Railway,
Fly.io). The image listens on `$PORT`. Set the settings above as env vars; keep
`GEMINI_API_KEY` in the host's secret store if it has one. Health check path: `/health`.

Run **one instance only** for now (on Cloud Run: `--max-instances 1`). The AI cache and limits
live in memory, so each extra instance would have its own counters, and a restart resets them.

**Frontend:** any static host (Cloudflare Pages, Netlify, Vercel). Root directory `frontend`,
build command `npm run build`, output directory `dist`, env var `VITE_API_BASE_URL` set to the
backend's URL.

Then set the backend's `CORS_ORIGINS` to the frontend's URL, or the browser will block every call.

## Check the real services work from your machine

From `backend/` with the venv active:

    python -c "from app.services.recipes import search_recipes; print([r.name for r in search_recipes('arrabiata')])"
    python -c "from app.services.ai_recipes import generate_recipe; r = generate_recipe('jollof rice'); print(r.name, [i.name for i in r.ingredients])"

The second one needs `GEMINI_API_KEY` and uses your Gemini quota. If it fails, read the error:
a 404 usually means the model name is wrong (set `GEMINI_MODEL`), a 400 can mean the schema was
rejected, and 429 means quota or rate limit.

    python -c "from app.services import stores; import json; print(json.dumps(stores.find_stores(51.272, 0.529, ['chicken thighs', 'garlic'], 'me'), indent=1)[:900])"

That one calls the public Overpass service (no key). It was written without internet access, so
this is the first real test of the query. If it fails or returns nothing, copy the query from
`stores.build_query` into Overpass Turbo (overpass-turbo.eu) to see what it says.

## Store finder

"Find stores near me" appears under the shopping list. It uses the browser's location, then the
API (`POST /api/stores`) asks OpenStreetMap for shops nearby.

- Items are sorted into supermarket, butcher, fishmonger and specialist by keyword
  (`classify` in `app/services/stores.py`). Edit the word lists there when an item lands in the
  wrong group. Meat and fish appear under supermarkets too; specialist items don't.
- We can't know what a shop stocks. Results say where an item is *likely* sold. "Specialist"
  shops are found by name words (asian, african, halal...), because OpenStreetMap has no tag for
  them, so that group is the least reliable.
- Position is sent in a POST body, never a URL, and isn't logged by the app. Results are cached
  in memory for 6 hours against a position rounded to about 100 m, so a rounded location is
  held in memory until then or a restart.
- Overpass is a free shared service. Check its usage policy before launching, keep the per-IP
  limit modest, and keep the OpenStreetMap contributors credit in the interface.
- Browsers only allow location on https pages (and localhost).

## Before going public

- Get a TheMealDB production key.
- Move the AI cache and limits to a shared store (e.g. Redis) if you need more than one instance.
- Decide on caching for database searches so repeat searches don't hit TheMealDB again.
