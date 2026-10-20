import { useEffect, useRef, useState } from "react";
import { downloadList, findStores } from "./api.js";
import { FindShopsCard, ShopChip, ShopPanel, formatDistance, getPosition, locationMessage } from "./StoreFinder.jsx";

// Only follow http(s) links from the API, never javascript: or anything else.
const safeLink = (href) => (/^https?:\/\//.test(href || "") ? href : "");

// Same as the backend's normalise(), so names match the store finder's answer.
const keyOf = (name) => name.toLowerCase().split(/\s+/).filter(Boolean).join(" ");

// The store finder's per-item answer, by ingredient key. Each entry keeps the radius it was
// searched with, because "Search a wider area" re-searches one item further out.
function indexShops(items, radius) {
  const shops = {};
  for (const item of items) shops[keyOf(item.name)] = { ...item, radius };
  return shops;
}

export default function RecipeView({ recipe, notice }) {
  const [have, setHave] = useState(new Set());
  const [stage, setStage] = useState("shop");  // "shop" while buying, "cook" once everything is in
  const [kitchenOpen, setKitchenOpen] = useState(false);
  const [error, setError] = useState("");
  // Store finder: one location and one search for the whole recipe, then "Not here" steps
  // through each item's shops in `route` without asking the server again.
  const [finder, setFinder] = useState({ working: false, error: "", position: null, shops: null });
  const [route, setRoute] = useState({});      // ingredient key -> index of the shop shown
  const [widened, setWidened] = useState({});  // ingredient key -> true once searched further
  const [selected, setSelected] = useState(null);  // ingredient name whose shops are open
  const [panelError, setPanelError] = useState("");
  const headingRef = useRef(null);
  const firstRender = useRef(true);

  const total = recipe.ingredients.length;
  const toGet = recipe.ingredients.filter((item) => !have.has(item.name));
  const inKitchen = recipe.ingredients.filter((item) => have.has(item.name));
  const isAI = recipe.source === "ai";
  const isPolished = recipe.source === "polished";
  const cuisine = recipe.area || recipe.category;
  const link = safeLink(recipe.source_url) || safeLink(recipe.page_url);
  // The panel only shows for an item still to get; ticking it elsewhere closes the panel.
  const openItem = toGet.find((item) => item.name === selected);
  const openShopsEntry = openItem && finder.shops?.[keyOf(openItem.name)];

  // When the stage changes, go to the top and move focus to the new heading so screen reader
  // and keyboard users land in the right place. Skipped on first render.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [stage]);

  async function findShops(openName) {
    setFinder((f) => ({ ...f, working: true, error: "" }));
    let position;
    try {
      position = await getPosition();
    } catch (err) {
      setFinder((f) => ({ ...f, working: false, error: locationMessage(err) }));
      return;
    }
    try {
      // Every ingredient, not just what's left, so unticking something later still works.
      const result = await findStores(position, recipe.ingredients.map((item) => item.name));
      setFinder({ working: false, error: "", position, shops: indexShops(result.items, result.radius_m) });
      setRoute({});
      setWidened({});
      if (openName) setSelected(openName);
    } catch (err) {
      setFinder((f) => ({ ...f, working: false, error: err.message }));
    }
  }

  function openShops(name) {
    setPanelError("");
    if (finder.shops) setSelected(selected === name ? null : name);
    else if (!finder.working) findShops(name);
  }

  function chipLabel(name) {
    if (finder.working) return "Finding shops...";
    const entry = finder.shops?.[keyOf(name)];
    if (!entry) return "Where to buy?";
    const shop = entry.stores[route[keyOf(name)] || 0];
    return shop ? `${shop.name} · ${formatDistance(shop.distance_m)}` : "None found nearby";
  }

  function notHere(name) {
    const key = keyOf(name);
    setRoute({ ...route, [key]: (route[key] || 0) + 1 });
  }

  function gotIt(name) {
    setHave(new Set(have).add(name));
    setSelected(null);
  }

  async function searchWider(name) {
    const key = keyOf(name);
    setPanelError("");
    setFinder((f) => ({ ...f, working: true }));
    try {
      const result = await findStores(finder.position, [name], true);
      setFinder((f) => ({ ...f, working: false, shops: { ...f.shops, ...indexShops(result.items, result.radius_m) } }));
      setRoute((r) => ({ ...r, [key]: 0 }));
      setWidened((w) => ({ ...w, [key]: true }));
    } catch (err) {
      setFinder((f) => ({ ...f, working: false }));
      setPanelError(err.message);
    }
  }

  function toggle(name) {
    const next = new Set(have);
    next.has(name) ? next.delete(name) : next.add(name);
    setHave(next);
  }

  // "Ingredients complete" means everything is in the kitchen, whatever was ticked before.
  function complete() {
    setHave(new Set(recipe.ingredients.map((item) => item.name)));
    setSelected(null);
    setStage("cook");
  }

  function backToShop() {
    setKitchenOpen(true);
    setStage("shop");
  }

  async function download(format) {
    setError("");
    try {
      await downloadList(recipe, [...have], format);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-8 sm:px-8">
      <section className="grid gap-4 lg:grid-cols-12">
        {stage === "shop" ? (
          <>
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

            {/* Title tile with the live "what's left to get" bar. */}
            <div className="rise flex flex-col justify-between gap-6 rounded-[36px] bg-orchid p-8 text-white [animation-delay:80ms] sm:p-10 lg:col-span-5">
              <div className="flex flex-wrap gap-2">
                {cuisine && <span className="rounded-full bg-white/15 px-3.5 py-2 text-sm">{cuisine}</span>}
                {isAI && <span className="rounded-full bg-white px-3.5 py-2 text-sm text-orchid">AI-written</span>}
                {isPolished && <span className="rounded-full bg-white px-3.5 py-2 text-sm text-orchid">Tidied up by AI</span>}
              </div>
              <h1 ref={headingRef} tabIndex={-1}
                className="font-display text-[clamp(40px,4.6vw,72px)] font-extrabold leading-[.92] [overflow-wrap:anywhere] tracking-[-.045em] outline-none">
                {recipe.name}
              </h1>
              <div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/20" aria-hidden="true">
                  <div className="h-full rounded-full bg-leaf transition-[width] duration-500"
                    style={{ width: (total ? (inKitchen.length / total) * 100 : 0) + "%" }} />
                </div>
                <p className="mt-3">
                  {toGet.length === 0 ? "You have everything" : `${inKitchen.length} in your kitchen, ${toGet.length} to get`}
                </p>
              </div>
            </div>
          </>
        ) : (
          /* Cook stage: the photo and hero make way for a short banner. */
          <div className="rise flex flex-wrap items-center justify-between gap-4 rounded-[36px] bg-leaf p-6 sm:p-8 lg:col-span-12">
            <div className="min-w-0">
              <p className="text-muted">{recipe.name}</p>
              <h1 ref={headingRef} tabIndex={-1}
                className="font-display text-[clamp(30px,3.6vw,44px)] font-extrabold leading-none tracking-[-.035em] outline-none">
                Everything's in. Let's cook.
              </h1>
            </div>
            <button onClick={backToShop}
              className="min-h-11 rounded-full border border-ink/30 px-5 hover:bg-white/50">
              Back to ingredients
            </button>
          </div>
        )}

        {isAI && (
          <p className="rounded-[24px] bg-white px-6 py-4 text-muted lg:col-span-12">
            An AI wrote this recipe. It isn't from the recipe database, so check quantities, cooking
            times and allergens before you rely on it.
          </p>
        )}
        {isPolished && (
          <p className="rounded-[24px] bg-white px-6 py-4 text-muted lg:col-span-12">
            This recipe is from the recipe database, rewritten by an AI to make it easier to follow.
            Check quantities, cooking times and allergens, and compare with the original linked below.
          </p>
        )}
        {notice && (
          <p role="status" className="rounded-[24px] bg-white px-6 py-4 text-muted lg:col-span-12">{notice}</p>
        )}

        {stage === "shop" ? (
          <>
            <IngredientsTile
              toGet={toGet} inKitchen={inKitchen}
              kitchenOpen={kitchenOpen} onToggleKitchen={() => setKitchenOpen(!kitchenOpen)}
              onToggle={toggle} onComplete={complete} onDownload={download} error={error}
              finder={finder} onFindShops={() => findShops()} selected={openItem?.name}
              chipLabel={chipLabel} onOpenShops={openShops} />
            <div className="flex flex-col gap-4 lg:col-span-7">
              {openItem && openShopsEntry && (
                <ShopPanel key={openItem.name}
                  item={{ ...openItem, note: openShopsEntry.note }}
                  shops={openShopsEntry.stores} index={route[keyOf(openItem.name)] || 0}
                  position={finder.position} radius={openShopsEntry.radius}
                  widened={!!widened[keyOf(openItem.name)]} working={finder.working} error={panelError}
                  onNotHere={() => notHere(openItem.name)} onGotIt={() => gotIt(openItem.name)}
                  onWider={() => searchWider(openItem.name)} onClose={() => setSelected(null)} />
              )}
              <LockedCookMode steps={recipe.steps} />
            </div>
          </>
        ) : (
          <>
            <CookMode steps={recipe.steps} link={link} />
            <IngredientReference ingredients={recipe.ingredients} />
          </>
        )}
      </section>
    </div>
  );
}

// Two lists: "Still to get" (live, this is the shopping list) and a collapsed "In your kitchen".
// Ticking moves an ingredient between them; unticking moves it back.
function IngredientsTile({ toGet, inKitchen, kitchenOpen, onToggleKitchen, onToggle, onComplete, onDownload, error,
                          finder, onFindShops, selected, chipLabel, onOpenShops }) {
  return (
    <div className="rise flex flex-col gap-6 rounded-[36px] bg-white p-6 [animation-delay:160ms] sm:p-8 lg:col-span-5">
      <div>
        <h2 className="font-display text-[28px] font-semibold tracking-tight">Ingredients</h2>
        <p className="mt-1 text-muted">
          Tick what you already have. It moves to your kitchen, and what's left is your shopping list.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 pb-2">
          <h3 className="font-display text-xl font-semibold">Still to get</h3>
          <span className="rounded-full bg-porcelain px-3 py-0.5 text-[15px] font-semibold text-orchid">{toGet.length}</span>
        </div>
        {toGet.length > 0 ? (
          <>
            {!finder.shops && <FindShopsCard working={finder.working} error={finder.error} onFind={onFindShops} />}
            <ul>
              {toGet.map((item) => (
                <IngredientRow key={item.name} item={item} owned={false} onToggle={onToggle}>
                  <ShopChip label={chipLabel(item.name)} selected={selected === item.name}
                    onClick={() => onOpenShops(item.name)} />
                </IngredientRow>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => onDownload("csv")}
                className="min-h-11 rounded-full border border-[#ddd3dd] bg-white px-5 text-[15px] hover:text-orchid">
                Download spreadsheet (CSV)
              </button>
              <button onClick={() => onDownload("md")}
                className="min-h-11 rounded-full border border-[#ddd3dd] bg-white px-5 text-[15px] hover:text-orchid">
                Download checklist
              </button>
            </div>
          </>
        ) : (
          <p className="border-t border-line pt-3.5 font-semibold text-sage">Nothing left to buy.</p>
        )}
        {error && <p role="alert" className="mt-3 text-orchid">{error}</p>}
      </div>

      <div>
        <button onClick={onToggleKitchen} aria-expanded={kitchenOpen} aria-controls="in-your-kitchen"
          className="flex min-h-14 w-full items-center gap-3 rounded-[20px] bg-[#edf3e8] px-4 py-3 text-left text-[17px]">
          <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#4f7a3a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" />
          </svg>
          <span className="font-semibold">In your kitchen</span>
          <span className="ml-auto rounded-full bg-white px-3 py-0.5 text-[15px] font-semibold text-sage">{inKitchen.length}</span>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={"transition-transform duration-200 " + (kitchenOpen ? "rotate-180" : "")}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {kitchenOpen && (
          <div id="in-your-kitchen" className="px-1 pt-2">
            {inKitchen.length > 0 ? (
              <>
                <ul>
                  {inKitchen.map((item) => (
                    <IngredientRow key={item.name} item={item} owned onToggle={onToggle} />
                  ))}
                </ul>
                <p className="mt-2.5 text-sm text-muted">Untick anything you ticked by mistake and it goes back on the list.</p>
              </>
            ) : (
              <p className="text-[15px] text-muted">Nothing ticked yet.</p>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <button onClick={onComplete}
          className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full bg-orchid text-[17px] font-semibold text-white hover:bg-ink">
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Ingredients complete
        </button>
        <p className="text-center text-sm text-muted">
          {toGet.length > 0
            ? "Back from the shops? This ticks everything off and opens cook mode."
            : "You have everything. Cook mode is ready."}
        </p>
      </div>
    </div>
  );
}

// `children` is the shop button on "Still to get". It sits outside the label, so tapping it
// doesn't tick the box.
function IngredientRow({ item, owned, onToggle, children }) {
  return (
    <li className={"border-t border-line " + (children ? "pb-2.5" : "")}>
      <label className="flex min-h-13 cursor-pointer items-center gap-3.5 py-1.5">
        <input type="checkbox" checked={owned} onChange={() => onToggle(item.name)} className="size-5.5 accent-sage" />
        <span className={"flex-1 text-[17px] " + (owned ? "text-muted" : "")}>{item.name}</span>
        <span className="text-right text-muted">{item.measure}</span>
      </label>
      {children && <div className="flex pl-9">{children}</div>}
    </li>
  );
}

// Shown in place of cook mode until the ingredients are complete. Peeking at the steps is
// allowed, so people can read ahead before they go shopping.
function LockedCookMode({ steps }) {
  const [peek, setPeek] = useState(false);

  return (
    <div className="rise flex flex-col gap-5 rounded-[36px] bg-white p-6 [animation-delay:240ms] sm:p-10 lg:col-span-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[28px] font-semibold tracking-tight">Cook mode</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-porcelain px-3 py-1.5 text-sm text-muted">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Locked
        </span>
      </div>
      <p className="font-display text-[clamp(24px,2.6vw,32px)] leading-[1.2] tracking-tight text-muted">
        Opens once your ingredients are complete.
      </p>
      <div className="flex gap-1.5" aria-hidden="true">
        {steps.map((_, i) => <span key={i} className="h-1.5 flex-1 rounded-full bg-line" />)}
      </div>
      <p className="text-muted">{steps.length} steps, shown one at a time, big enough to read from across the kitchen.</p>
      <div>
        <button onClick={() => setPeek(!peek)} aria-expanded={peek} aria-controls="peek-steps"
          className="min-h-11 text-orchid underline underline-offset-4">
          {peek ? "Hide the steps" : "Peek at the steps"}
        </button>
        {peek && (
          <ol id="peek-steps" className="mt-3 space-y-4">
            {steps.map((text, i) => (
              <li key={i} className="grid grid-cols-[2.25rem_1fr] gap-2.5">
                <span className="font-display text-[22px] font-extrabold text-orchid">{i + 1}</span>
                <span className="text-[17px] leading-relaxed">{text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

// Read-only amounts beside the steps, so nobody has to go back to check "how much thyme".
function IngredientReference({ ingredients }) {
  return (
    <div className="rise rounded-[36px] bg-white p-6 [animation-delay:160ms] sm:p-8 lg:col-span-5">
      <h2 className="font-display text-[28px] font-semibold tracking-tight">Ingredients</h2>
      <p className="mb-3 mt-1 text-muted">Amounts at a glance while you cook.</p>
      <ul>
        {ingredients.map((item) => (
          <li key={item.name} className="flex justify-between gap-4 border-t border-line py-2.5">
            <span>{item.name}</span>
            <span className="text-right text-muted">{item.measure}</span>
          </li>
        ))}
      </ul>
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
