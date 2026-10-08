import { useState } from "react";
import { searchRecipes, generateRecipe, polishRecipe } from "./api.js";
import RecipeView from "./RecipeView.jsx";

export default function App() {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState("");   // the query the results belong to
  const [results, setResults] = useState(null);   // null = nothing searched yet
  const [recipe, setRecipe] = useState(null);
  const [busy, setBusy] = useState("");           // what we're waiting for, shown to the user
  const [error, setError] = useState("");
  const [tired, setTired] = useState("");         // the AI limit message, kept separate on purpose
  const [notice, setNotice] = useState("");       // explains where the open recipe came from

  async function onSearch(event) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
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

  const compact = recipe !== null;

  return (
    <div className="min-h-screen">
      <header className={compact ? "pt-5 pb-4" : "pt-[14vh] pb-10"}>
        <div className="mx-auto max-w-5xl px-4 sm:px-8">
          {compact ? (
            <button onClick={() => setRecipe(null)}
              className="font-display text-2xl text-fig hover:text-raspberry">
              Recipe Finder
            </button>
          ) : (
            <h1 className="font-display text-5xl leading-[1.05] sm:text-7xl">
              What are we<br />cooking tonight?
            </h1>
          )}

          <form onSubmit={onSearch} className={"flex items-end gap-3 " + (compact ? "mt-3" : "mt-10")}>
            <label className="flex-1">
              <span className="sr-only">Dish name</span>
              <input value={query} onChange={(e) => setQuery(e.target.value)} maxLength={100}
                placeholder="Type a dish, like shawarma"
                className={"w-full border-b-2 border-fig/30 bg-transparent pb-2 placeholder:text-fig/40 " +
                  "focus:border-raspberry focus:outline-none " + (compact ? "text-lg" : "text-2xl sm:text-3xl")} />
            </label>
            <button disabled={!!busy}
              className="rounded-full bg-raspberry px-6 py-3 font-medium text-milk hover:bg-fig disabled:opacity-60">
              Find recipe
            </button>
          </form>

          <p role="status" className="mt-4 min-h-6 text-fig/70">{busy || notice}</p>
          {error && <p className="text-raspberry">{error}</p>}
        </div>
      </header>

      {!compact && results !== null && (
        <Results results={results} query={searched} tired={tired} busy={busy}
          onPick={onPick} onGenerate={() => generate(searched)} />
      )}

      {compact && <RecipeView key={recipe.id || recipe.name} recipe={recipe} />}

      <footer className="mx-auto max-w-5xl px-4 py-12 text-sm text-fig/60 sm:px-8">
        Database recipes come from{" "}
        <a className="underline" href="https://www.themealdb.com/" target="_blank" rel="noopener">TheMealDB</a>.
        Recipes marked as AI-written are made by an AI model. Always check labels for allergens.
      </footer>
    </div>
  );
}

function Results({ results, query, tired, busy, onPick, onGenerate }) {
  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-8">
      {results.length === 0 ? (
        <p className="text-lg">Nothing in the recipe database for “{query}”.</p>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((r) => (
            <li key={r.id}>
              <button onClick={() => onPick(r)} disabled={!!busy}
                className="group block w-full overflow-hidden rounded-[2rem] bg-milk text-left disabled:opacity-60">
                {r.thumbnail && (
                  <img src={r.thumbnail} alt="" loading="lazy"
                    className="aspect-[4/3] w-full object-cover transition duration-500 group-hover:scale-105" />
                )}
                <span className="block px-5 py-4">
                  <span className="block font-display text-xl">{r.name}</span>
                  <span className="text-sm text-fig/60">{r.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        {tired ? (
          <p className="inline-block rounded-full bg-milk px-6 py-3 text-raspberry">{tired}</p>
        ) : (
          <button onClick={onGenerate} disabled={!!busy}
            className="rounded-full border-2 border-dashed border-raspberry/50 px-6 py-3 text-raspberry hover:border-raspberry disabled:opacity-60">
            {results.length === 0 ? "Write one with AI instead" : "Not quite it? Write one with AI"}
          </button>
        )}
      </div>
    </main>
  );
}
