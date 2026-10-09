import { useState } from "react";
import { buildShoppingList, downloadList } from "./api.js";

// Only follow http(s) links from the API, never javascript: or anything else.
const safeLink = (href) => (/^https?:\/\//.test(href || "") ? href : "");

export default function RecipeView({ recipe, notice }) {
  const [have, setHave] = useState(new Set());
  const [list, setList] = useState(null);
  const [error, setError] = useState("");

  const total = recipe.ingredients.length;
  const toBuy = total - have.size;
  const isAI = recipe.source === "ai";
  const isPolished = recipe.source === "polished";
  const cuisine = recipe.area || recipe.category;

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
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-8 sm:px-8">
      <section className="grid gap-4 lg:grid-cols-12">
        {/* Photo tile. AI recipes have no photo, so they get a tinted tile instead. */}
        <div className="rise relative min-h-80 overflow-hidden rounded-[36px] bg-[#d9e3d2] lg:col-span-7 lg:min-h-[480px]">
          {recipe.thumbnail ? (
            <img src={recipe.thumbnail} alt={recipe.name} onError={(e) => { e.currentTarget.style.display = "none"; }} className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center p-10 text-center font-display text-2xl text-ink/50">
              No photo for AI-written recipes
            </span>
          )}
        </div>

        {/* Title tile with the live "what's left to buy" bar. */}
        <div className="rise flex flex-col justify-between gap-6 rounded-[36px] bg-orchid p-8 text-white [animation-delay:80ms] sm:p-10 lg:col-span-5">
          <div className="flex flex-wrap gap-2">
            {cuisine && <span className="rounded-full bg-white/15 px-3.5 py-2 text-sm">{cuisine}</span>}
            {isAI && <span className="rounded-full bg-white px-3.5 py-2 text-sm text-orchid">AI-written</span>}
            {isPolished && <span className="rounded-full bg-white px-3.5 py-2 text-sm text-orchid">Tidied up by AI</span>}
          </div>
          <h1 className="font-display text-[clamp(40px,4.6vw,72px)] font-extrabold leading-[.92] [overflow-wrap:anywhere] tracking-[-.045em]">
            {recipe.name}
          </h1>
          <div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/20">
              <div className="h-full rounded-full bg-leaf transition-[width] duration-500"
                style={{ width: (total ? (have.size / total) * 100 : 0) + "%" }} />
            </div>
            <p className="mt-3">
              {toBuy === 0 ? "You have everything" : `${have.size} in your kitchen, ${toBuy} to buy`}
            </p>
          </div>
        </div>

        {isAI && (
          <p className="rounded-[24px] bg-white px-6 py-4 text-muted lg:col-span-12">
            An AI wrote this recipe, so check quantities, cooking times and allergens before you
            rely on it.
          </p>
        )}
        {isPolished && (
          <p className="rounded-[24px] bg-white px-6 py-4 text-muted lg:col-span-12">
            An AI rewrote this recipe to make it easier to follow.
            Check quantities, cooking times and allergens, and compare with the original linked below.
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-[24px] bg-white px-6 py-4 text-muted lg:col-span-12">{notice}</p>
        )}

        {/* Ingredients tile. */}
        <div className="rise rounded-[36px] bg-white p-6 [animation-delay:160ms] sm:p-8 lg:col-span-5">
          <h2 className="font-display text-[28px] font-semibold tracking-tight">Ingredients</h2>
          <p className="mb-4 mt-1 text-muted">Check off what you already have.</p>
          <ul>
            {recipe.ingredients.map((item) => {
              const owned = have.has(item.name);
              return (
                <li key={item.name} className="border-t border-line">
                  <label className="flex min-h-13 cursor-pointer items-center gap-3.5 py-2">
                    <input type="checkbox" checked={owned} onChange={() => toggle(item.name)}
                      className="size-5.5 accent-sage" />
                    <span className={"flex-1 text-[17px] transition-colors " + (owned ? "text-muted line-through" : "")}>
                      {item.name}
                    </span>
                    <span className="text-right text-muted">{item.measure}</span>
                  </label>
                </li>
              );
            })}
          </ul>

          {toBuy > 0 && !list && (
            <button onClick={makeList}
              className="mt-6 min-h-14 w-full rounded-full bg-ink font-semibold text-white hover:bg-orchid">
              Make my shopping list
            </button>
          )}
          {list && (
            <div className="mt-6 rounded-[24px] bg-porcelain p-5">
              <p className="font-display text-xl font-semibold">Your shopping list</p>
              <ul className="mt-3 space-y-1.5">
                {list.map((item) => (
                  <li key={item.name} className="flex justify-between gap-4">
                    <span>{item.name}</span>
                    <span className="text-muted">{item.measure}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <button onClick={() => download("csv")}
                  className="min-h-11 rounded-full bg-orchid px-5 text-sm font-semibold text-white hover:bg-ink">
                  Download spreadsheet (CSV)
                </button>
                <button onClick={() => download("md")}
                  className="min-h-11 rounded-full border border-[#ddd3dd] bg-white px-5 text-sm hover:text-orchid">
                  Download checklist
                </button>
              </div>
            </div>
          )}
          {error && <p className="mt-3 text-orchid">{error}</p>}
        </div>

        <CookMode steps={recipe.steps} link={safeLink(recipe.source_url) || safeLink(recipe.page_url)} />
      </section>
    </div>
  );
}

// One step at a time, big enough to read from across the kitchen. "See all steps" shows the
// whole method at once for people who like to read ahead.
function CookMode({ steps, link }) {
  const [step, setStep] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const last = steps.length - 1;

  return (
    <div className="rise flex flex-col gap-6 rounded-[36px] bg-white p-6 [animation-delay:240ms] sm:p-10 lg:col-span-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[28px] font-semibold tracking-tight">
          {showAll ? "Method" : "Cook mode"}
        </h2>
        <button onClick={() => setShowAll(!showAll)} className="min-h-11 text-muted underline underline-offset-4 hover:text-orchid">
          {showAll ? "One step at a time" : "See all steps"}
        </button>
      </div>

      {showAll ? (
        <ol className="space-y-5">
          {steps.map((text, i) => (
            <li key={i} className="grid grid-cols-[2.5rem_1fr] gap-3">
              <span className="font-display text-2xl font-extrabold text-orchid">{i + 1}</span>
              <p className="max-w-prose text-lg leading-relaxed">{text}</p>
            </li>
          ))}
        </ol>
      ) : (
        <>
          <div className="flex gap-1.5" aria-hidden="true">
            {steps.map((_, i) => (
              <span key={i} className={"h-1.5 flex-1 rounded-full transition-colors " + (i <= step ? "bg-orchid" : "bg-line")} />
            ))}
          </div>
          <p className="text-muted">Step {step + 1} of {steps.length}</p>
          {/* key makes the text re-animate on every step change */}
          <p key={step} className="rise min-h-44 font-display text-[clamp(26px,3vw,38px)] leading-[1.15] tracking-tight" aria-live="polite">
            {steps[step]}
          </p>
          <div className="flex gap-2">
            <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}
              className="min-h-13 rounded-full border border-[#ddd3dd] px-6 disabled:opacity-40">
              Back
            </button>
            <button onClick={() => setStep(step === last ? 0 : step + 1)}
              className="min-h-13 rounded-full bg-orchid px-7 font-semibold text-white hover:bg-ink">
              {step === last ? "Start again" : "Next step"}
            </button>
          </div>
        </>
      )}

      {link && (
        <a href={link} target="_blank" rel="noopener" className="mt-auto text-muted underline underline-offset-4 hover:text-orchid">
          See the original recipe
        </a>
      )}
    </div>
  );
}
