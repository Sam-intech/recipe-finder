# Recipe Finder (stage 1 + AI fallback)

Dish name in, recipe out, tick what you already have, get the list of what to buy, download it.
Recipes come from TheMealDB first. If there is no match (or the user says "none of these"),
they can click to have an AI model write one, clearly labelled as AI-generated.
No location, shops or prices yet (stages 2 and 3).

## Run

    python3 -m venv .venv
    . .venv/bin/activate
    pip install -r requirements.txt
    python -m pytest -q                      # offline tests, no network or keys needed
    # put your key in .env (GEMINI_API_KEY=...), only needed for the AI fallback
    uvicorn app.main:app --reload --env-file .env   # then open http://127.0.0.1:8000

## Check the real services work from your machine

    python -c "from app.core.recipes import search_recipes; print([r.name for r in search_recipes('arrabiata')])"
    python -c "from app.core.ai_recipes import generate_recipe; r = generate_recipe('jollof rice'); print(r.name, [i.name for i in r.ingredients])"

The second one needs GEMINI_API_KEY and uses your Gemini quota. It has NOT been run live yet.
If it fails, read the error: a 404 usually means the model name is wrong (set `GEMINI_MODEL`),
a 400 can mean the schema was rejected, and 429 means quota or rate limit.

## Settings (environment variables)

- `THEMEALDB_API_KEY`: defaults to the dev key `1` (dev/educational use only; a public app needs a paid key).
- `GEMINI_API_KEY`: enables AI generation. Without it the button returns a clear "not set up" error.
- `GEMINI_MODEL`: defaults to `gemini-3.5-flash-lite`. Model names change often; check Google's current list.
- `AI_DAILY_CAP`: total AI calls allowed per day (UTC), default 20. Repeat dishes come from the cache and don't count.
- `AI_PER_IP_LIMIT`: AI calls per IP per hour, default 5. Limits and cache are in memory and reset on restart.

## Layout

- `app/core/recipes.py`: fetch + parse TheMealDB, merge duplicate ingredient rows.
- `app/core/ai_recipes.py`: AI generation via Gemini (JSON schema), with validation of everything returned.
- `app/core/shopping.py`: shopping list logic and CSV/markdown export.
- `app/main.py`: thin FastAPI layer over the core.
- `app/static/index.html`: the whole frontend for now (plain JS + Tailwind CDN).
- `tests/`: unit tests; the network and the AI client are faked.

## Before deploying publicly

- Add rate limiting to `/api/recipes/generate`. It spends money on every call and is not limited yet.
- Get a TheMealDB production key.
- Decide on caching so repeat searches do not hit the services again.
