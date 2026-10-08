import { useEffect, useState } from "react";
import { searchRecipes, generateRecipe, polishRecipe } from "./api.js";
import RecipeView from "./RecipeView.jsx";

// Starter dishes for the photo ribbon. Each [name, fallback tint, tilt in degrees, height].
const RIBBON = [
  ["Shakshuka", "#e9d6e6", -6, 260],
  ["Shawarma", "#d9e3d2", -3, 320],
  ["Jollof", "#f1d2cf", 0, 380],
  ["Pho", "#d8d4ea", 3, 320],
  ["Pad Thai", "#efe0c9", 6, 260],
];

export default function App() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");
  const [results, setResults] = useState(null);   // null = nothing searched yet
  const [recipe, setRecipe] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [tired, setTired] = useState("");
  const [notice, setNotice] = useState("");   // explains where the open recipe came from

  async function runSearch(q) {
    q = q.trim();
    if (!q) return;
    setQuery(q);
    setRecipe(null);
    setError("");
    setNotice("");
    setBusy("Looking through the recipe box...");
    let found;
    try {
      found = await searchRecipes(q);
      setResults(found);
      setSearched(q);
    } catch (err) {
      setError(err.message);
      setBusy("");
      return;
    }
    // Nothing in the database: go straight to the AI instead of waiting for a click.
    if (found.length === 0) await generate(q, `Nothing in the recipe database for “${q}”, so an AI wrote this one.`);
    else setBusy("");
  }

  async function generate(q, note = "") {
    setError("");
    setBusy("Writing a recipe for " + q + ". This takes a few seconds...");
    try {
      setRecipe(await generateRecipe(q));
      setNotice(note);
    } catch (err) {
      if (err.status === 429) setTired(err.message);
      else setError(err.message);
    } finally {
      setBusy("");
    }
  }

  // Database recipes are rewritten by the AI before they're shown. If that fails for any
  // reason (limits, no key, AI error), the original still opens, so the user isn't stuck.
  async function onPick(picked) {
    setError("");
    setNotice("");
    setBusy("Tidying up " + picked.name + "...");
    try {
      setRecipe(await polishRecipe(picked.id));
    } catch {
      setRecipe(picked);
      setNotice("Couldn't tidy this recipe up right now, so here it is as the database has it.");
    } finally {
      setBusy("");
    }
  }

  function goHome() {
    setRecipe(null);
    setResults(null);
    setQuery("");
  }

  return (
    <div className="min-h-screen overflow-x-hidden">
      <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-8">
        <nav className="flex items-center justify-between gap-4">
          <button onClick={goHome}
            className="font-display text-[22px] font-extrabold tracking-tight">
            recipe finder
          </button>
          {recipe && (
            <button onClick={() => setRecipe(null)}
              className="min-h-11 rounded-full bg-white px-5 text-sm hover:text-orchid">
              Back to results
            </button>
          )}
        </nav>
      </div>

      {recipe ? (
        <RecipeView key={recipe.id || recipe.name} recipe={recipe} notice={notice} />
      ) : (
        <>
          <Hero query={query} setQuery={setQuery} busy={busy} onSearch={runSearch}
            compact={results !== null} />
          <div className="mx-auto max-w-6xl px-4 sm:px-8">
            <p role="status" className="min-h-6 text-center text-muted">{busy}</p>
            {error && <p className="text-center text-orchid">{error}</p>}
          </div>
          {results === null ? (
            <Ribbon onPick={runSearch} />
          ) : (
            <Results results={results} query={searched} tired={tired} busy={busy}
              onPick={onPick} onGenerate={() => generate(searched)} />
          )}
        </>
      )}

      <footer className="mx-auto max-w-6xl px-4 py-14 text-sm text-muted sm:px-8">
        Database recipes and photos come from{" "}
        <a className="underline" href="https://www.themealdb.com/" target="_blank" rel="noopener">TheMealDB</a>.
        Recipes marked as AI-written are made by an AI model. Always check labels for allergens.
      </footer>
    </div>
  );
}

function Hero({ query, setQuery, busy, onSearch, compact }) {
  return (
    <section className={"mx-auto max-w-6xl px-4 text-center sm:px-8 " + (compact ? "mt-10" : "mt-20 sm:mt-24")}>
      {!compact && (
        <>
          <h1 className="mx-auto max-w-4xl font-display text-[clamp(52px,8vw,112px)] font-extrabold leading-[.95] tracking-[-.045em]">
            What are we cooking tonight?
          </h1>
          <p className="mx-auto mt-6 max-w-lg text-lg text-muted">
            A dish name in. A recipe, a tick-list and a shopping list out.
          </p>
        </>
      )}
      <form onSubmit={(e) => { e.preventDefault(); onSearch(query); }}
        className="mx-auto mt-10 flex max-w-xl gap-2 rounded-full bg-white p-2 shadow-[0_20px_50px_-20px_rgba(122,46,119,.35)]">
        <label className="flex min-w-0 flex-1">
          <span className="sr-only">Dish name</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100}
            placeholder="Shawarma, jollof, pho..."
            className="min-w-0 flex-1 bg-transparent px-5 text-lg placeholder:text-[#8a7f8c] focus:outline-none" />
        </label>
        <button disabled={!!busy}
          className="min-h-14 shrink-0 rounded-full bg-orchid px-5 font-semibold sm:px-7 text-white hover:bg-ink disabled:opacity-60">
          Find recipe
        </button>
      </form>
    </section>
  );
}

// The fanned photo ribbon. Photos come from the recipe database, so each starter dish
// is looked up once when the page loads. If a lookup fails we keep the tinted tile.
function Ribbon({ onPick }) {
  const [photos, setPhotos] = useState({});

  useEffect(() => {
    let cancelled = false;
    RIBBON.forEach(([name]) => {
      searchRecipes(name)
        .then((found) => {
          const thumb = found[0]?.thumbnail;
          if (thumb && !cancelled) setPhotos((p) => ({ ...p, [name]: thumb }));
        })
        .catch(() => {});
    });
    return () => { cancelled = true; };  // don't update state after the user has moved on
  }, []);

  return (
    <section className="mt-12 pb-8">
      <div className="flex snap-x gap-5 overflow-x-auto px-6 pb-6 pt-6 sm:justify-center sm:overflow-visible">
        {RIBBON.map(([name, tint, tilt, height]) => (
          <button key={name} onClick={() => onPick(name)}
            style={{ "--tilt": tilt + "deg", height }}
            className="group relative w-48 shrink-0 snap-center overflow-hidden rounded-[28px] transition-transform duration-500 ease-out sm:w-56 sm:[transform:rotate(var(--tilt))] sm:hover:[transform:rotate(0deg)_translateY(-18px)_scale(1.04)]">
            <span className="absolute inset-0" style={{ background: tint }} />
            {photos[name] && (
              <img src={photos[name]} alt="" loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
            )}
            <span className="absolute inset-x-3 bottom-3 rounded-[18px] bg-white/85 px-4 py-3 text-left font-display text-lg font-semibold backdrop-blur">
              {name}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-center text-muted">Tap a dish to see its recipes.</p>
    </section>
  );
}

function Results({ results, query, tired, busy, onPick, onGenerate }) {
  return (
    <main className="mx-auto mt-6 max-w-6xl px-4 sm:px-8">
      {results.length === 0 ? (
        <p className="text-center text-lg">Nothing in the recipe database for “{query}”.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((r) => (
            <li key={r.id}>
              <button onClick={() => onPick(r)} disabled={!!busy}
                className="group block w-full overflow-hidden rounded-[28px] bg-white text-left disabled:opacity-60">
                <span className="block aspect-[4/3] overflow-hidden bg-line">
                  {r.thumbnail && (
                    <img src={r.thumbnail} alt="" loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                  )}
                </span>
                <span className="block px-5 py-4">
                  <span className="block font-display text-xl font-semibold tracking-tight">{r.name}</span>
                  <span className="text-sm text-muted">{r.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 text-center">
        {tired ? (
          <p className="inline-block rounded-full bg-white px-6 py-3 text-orchid">{tired}</p>
        ) : (
          <button onClick={onGenerate} disabled={!!busy}
            className="min-h-12 rounded-full border-2 border-dashed border-orchid/40 px-6 text-orchid hover:border-orchid disabled:opacity-60">
            {results.length === 0 ? "Write one with AI instead" : "Not quite it? Write one with AI"}
          </button>
        )}
      </div>
    </main>
  );
}
