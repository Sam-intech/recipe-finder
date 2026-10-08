import { useState } from "react";
import { buildShoppingList, downloadList } from "./api.js";

// Only follow http(s) links from the API, never javascript: or anything else.
const safeLink = (href) => (/^https?:\/\//.test(href || "") ? href : "");

export default function RecipeView({ recipe }) {
  const [have, setHave] = useState(new Set());
  const [list, setList] = useState(null);
  const [error, setError] = useState("");

  const isAI = recipe.source === "ai";
  const link = safeLink(recipe.source_url) || safeLink(recipe.page_url);
  const toBuy = recipe.ingredients.length - have.size;

  function toggle(name) {
    const next = new Set(have);
    next.has(name) ? next.delete(name) : next.add(name);
    setHave(next);
    setList(null);  // the old list is out of date once a tick changes
  }

  async function makeList() {
    setError("");
    try {
      setList(await buildShoppingList(recipe, [...have]));
    } catch (err) {
      setError(err.message);
    }
  }

  async function download(format) {
    try {
      await downloadList(recipe, [...have], format);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <article className="rise">
      {/* The immersive moment: the dish fills the screen. */}
      <section className={"relative isolate flex items-end overflow-hidden bg-fig " +
        (recipe.thumbnail ? "min-h-[55vh]" : "min-h-[34vh]")}>
        {recipe.thumbnail && (
          <img src={recipe.thumbnail} alt="" className="absolute inset-0 -z-10 h-full w-full object-cover opacity-70" />
        )}
        {!recipe.thumbnail && (
          <div className="absolute -top-1/2 -right-1/4 -z-10 size-[70vmax] rounded-full bg-raspberry/40 blur-3xl" />
        )}
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-fig via-fig/40 to-transparent" />
        <div className="mx-auto w-full max-w-5xl px-4 pb-10 sm:px-8">
          <h2 className="font-display text-5xl leading-none text-milk sm:text-7xl">{recipe.name}</h2>
          {recipe.description && <p className="mt-4 max-w-xl text-lg text-milk/80">{recipe.description}</p>}
        </div>
      </section>

      {isAI && (
        <p className="mx-auto mt-6 max-w-5xl px-4 text-fig/80 sm:px-8">
          An AI wrote this recipe. It isn't from the recipe database, so check quantities,
          cooking times and allergens before you rely on it.
        </p>
      )}

      <div className="mx-auto grid max-w-5xl gap-12 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="lg:sticky lg:top-6 lg:self-start">
          <h3 className="font-display text-3xl">Ingredients</h3>
          <p className="mt-1 text-fig/70">Tap what's already in your kitchen.</p>

          <ul className="mt-5 flex flex-wrap gap-2">
            {recipe.ingredients.map((item) => {
              const owned = have.has(item.name);
              return (
                <li key={item.name}>
                  <button onClick={() => toggle(item.name)} aria-pressed={owned}
                    className={"rounded-full px-4 py-2 text-left transition-colors " +
                      (owned ? "bg-pistachio text-fig/60 line-through" : "bg-milk hover:bg-mist/60")}>
                    {item.name}
                    {item.measure && <span className="ml-2 text-sm text-fig/50">{item.measure}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-8 rounded-[2rem] bg-milk p-6">
            <p className="font-display text-2xl">
              {toBuy === 0 ? "You have everything" : `${toBuy} to buy`}
            </p>
            {toBuy > 0 && !list && (
              <button onClick={makeList}
                className="mt-4 rounded-full bg-raspberry px-6 py-3 font-medium text-milk hover:bg-fig">
                Make my shopping list
              </button>
            )}
            {list && (
              <>
                <ul className="mt-4 space-y-2">
                  {list.map((item) => (
                    <li key={item.name} className="flex justify-between gap-4 border-b border-mist pb-2">
                      <span>{item.name}</span>
                      <span className="text-fig/60">{item.measure}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button onClick={() => download("csv")}
                    className="rounded-full border border-fig/30 px-4 py-2 text-sm hover:border-raspberry hover:text-raspberry">
                    Download spreadsheet (CSV)
                  </button>
                  <button onClick={() => download("md")}
                    className="rounded-full border border-fig/30 px-4 py-2 text-sm hover:border-raspberry hover:text-raspberry">
                    Download checklist
                  </button>
                </div>
              </>
            )}
            {error && <p className="mt-3 text-raspberry">{error}</p>}
          </div>
        </section>

        <section>
          <h3 className="font-display text-3xl">Method</h3>
          <ol className="mt-5 space-y-6">
            {recipe.steps.map((step, i) => (
              <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-3">
                <span className="font-display text-3xl leading-none text-raspberry">{i + 1}</span>
                <p className="max-w-prose text-lg leading-relaxed">{step}</p>
              </li>
            ))}
          </ol>
          {link && (
            <a href={link} target="_blank" rel="noopener"
              className="mt-8 inline-block underline decoration-raspberry underline-offset-4">
              See the original recipe
            </a>
          )}
        </section>
      </div>
    </article>
  );
}
