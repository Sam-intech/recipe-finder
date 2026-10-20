import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Browsers only allow location on https:// pages (and localhost), and only after the user
// says yes. Each failure gets its own message so people know what to do next.
export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser can't share your location, so we can't look for shops."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      reject,
      {
        timeout: 10000,
        maximumAge: 5 * 60 * 1000,  // a position from the last 5 minutes is fine
      },
    );
  });
}

export function locationMessage(err) {
  // GeolocationPositionError codes: 1 = denied, 2 = unavailable, 3 = timed out.
  if (err.code === 1) {
    return "Location is blocked for this site. Allow it in your browser's site settings, then try again. Your list still works without it.";
  }
  if (err.code === 2) {
    return "Your device couldn't work out where you are. Try again with a better signal.";
  }
  if (err.code === 3) return "Finding your location took too long. Try again.";
  return err.message;
}

// UK and US readers expect miles, so use those for en-GB and en-US browsers.
const useMiles = () => /^en-(GB|US)/i.test(navigator.language || "");

export function formatDistance(metres) {
  if (useMiles()) {
    const miles = metres / 1609.34;
    return miles < 0.1 ? "under 0.1 miles" : miles.toFixed(1).replace(/\.0$/, "") + " miles";
  }
  return metres < 1000 ? Math.round(metres / 10) * 10 + " m" : (metres / 1000).toFixed(1) + " km";
}

// Turn-by-turn is handed to the phone's maps. This Google Maps link opens the app if it is
// installed and the website if not.
const directionsLink = (shop) =>
  `https://www.google.com/maps/dir/?api=1&destination=${shop.lat},${shop.lon}&travelmode=walking`;

// The button at the top of "Still to get", before any search has run.
export function FindShopsCard({ working, error, onFind }) {
  return (
    <div className="mb-3 flex flex-col gap-2.5 rounded-[20px] bg-porcelain p-4">
      <p className="font-display text-lg font-semibold">Where to buy</p>
      <p className="text-[15px] text-muted">
        See the nearest shop likely to sell each item. Your location is only used to look for shops.
      </p>
      <button onClick={onFind} disabled={working}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-full bg-orchid px-5 font-semibold text-white hover:bg-ink disabled:opacity-60">
        <PinIcon size={18} />
        {working ? "Finding shops..." : "Find shops near me"}
      </button>
      {error && <p role="alert" className="text-orchid">{error}</p>}
    </div>
  );
}

// The small button under each item on "Still to get": its current shop, or a prompt to search.
export function ShopChip({ label, selected, onClick }) {
  return (
    <button onClick={onClick} aria-pressed={selected}
      className={"inline-flex min-h-9 items-center gap-1.5 self-start rounded-full border px-3 text-sm text-orchid " +
        (selected ? "border-orchid bg-porcelain font-semibold" : "border-[#ddd3dd] bg-white hover:bg-porcelain")}>
      <PinIcon size={15} />
      {label}
    </button>
  );
}

// Where to buy one item. A bottom sheet on phones, a tile beside the list on wide screens.
// "Not here" moves to the next nearest shop for this item only: a shop without sumac may
// still have the garlic.
export function ShopPanel({ item, shops, index, position, radius, widened, working, error,
                            onNotHere, onGotIt, onWider, onClose }) {
  const shop = shops[index];
  const skipped = shops.slice(0, index).map((s) => s.name);
  const next = shops.slice(index + 1, index + 3);
  const [showMap, setShowMap] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const headingRef = useRef(null);

  // Land on the heading when the panel opens or moves to another item.
  useEffect(() => {
    headingRef.current?.focus();
  }, [item.name]);

  return (
    <>
      <button aria-label="Close" onClick={onClose} className="fixed inset-0 z-30 bg-ink/45 lg:hidden" />
      <div role="region" aria-label={"Where to buy " + item.name}
        onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        className="fixed inset-x-0 bottom-0 z-40 flex max-h-[88vh] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-white p-5 pb-7 sm:p-8 lg:static lg:z-auto lg:max-h-none lg:rounded-[36px]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 ref={headingRef} tabIndex={-1}
              className="font-display text-[26px] font-semibold tracking-tight outline-none [overflow-wrap:anywhere] sm:text-[28px]">
              Where to buy {item.name.toLowerCase()}
            </h2>
            {item.measure && <p className="text-muted">{item.measure}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-porcelain hover:text-orchid">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {skipped.length > 0 && shop && (
          <p role="status" className="rounded-[16px] bg-porcelain px-4 py-2.5 text-[15px] text-muted">
            Not at {skipped.join(" or ")}. Here's the next nearest.
          </p>
        )}

        {shop ? (
          <>
            <div className="flex flex-wrap gap-4">
              <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-3">
                <div className="flex flex-col gap-1 rounded-[20px] border border-line p-4">
                  <span className="text-[13px] font-semibold uppercase tracking-wide text-orchid">
                    {index === 0 ? "Nearest likely shop" : "Next nearest"}
                  </span>
                  <p className="font-display text-[21px] font-semibold [overflow-wrap:anywhere]">{shop.name}</p>
                  <p className="text-muted">{shop.kind} · {formatDistance(shop.distance_m)}</p>
                  {shop.address && <p className="text-muted">{shop.address}</p>}
                  {shop.opening_hours && <p className="text-muted">Hours: {shop.opening_hours}</p>}
                  {item.note && <p className="mt-1.5 text-sm text-muted">{item.note}</p>}
                </div>

                {!showMap && (
                  <button onClick={() => setShowMap(true)}
                    className="inline-flex min-h-13 items-center justify-center gap-2 rounded-full bg-orchid text-[17px] font-semibold text-white hover:bg-ink">
                    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 11l18-8-8 18-2-8z" />
                    </svg>
                    Directions
                  </button>
                )}

                {showMap && <p className="font-semibold">At the shop? Did they have it?</p>}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={onNotHere}
                    className="min-h-12 rounded-full border border-[#ddd3dd] bg-white hover:text-orchid">
                    Not here
                  </button>
                  <button onClick={onGotIt}
                    className="min-h-12 rounded-full bg-[#edf3e8] font-semibold text-sage hover:bg-leaf">
                    Got it
                  </button>
                </div>
                {next.length > 0 && (
                  <p className="text-sm text-muted">
                    If it isn't there: next is {next.map((s) => `${s.name} (${formatDistance(s.distance_m)})`).join(", then ")}.
                  </p>
                )}
              </div>

              {showMap && (
                <div className="flex min-w-0 flex-[1_1_260px] flex-col gap-2">
                  <ShopMap from={position} to={shop} />
                  <a href={directionsLink(shop)} target="_blank" rel="noopener"
                    className="inline-flex min-h-11 items-center self-center text-[15px] text-orchid underline underline-offset-4">
                    Turn-by-turn in your maps app
                  </a>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="font-display text-xl leading-snug">
              {skipped.length > 0 ? "No other shops" : "No shops"} within {formatDistance(radius)} are likely to sell it.
            </p>
            <p className="text-muted">
              It stays on your list.{" "}
              {widened ? "That was already the wider search, so this one may need a specialist shop or an online order." : "You could look further away."}
            </p>
            {!widened && (
              <button onClick={onWider} disabled={working}
                className="min-h-12 self-start rounded-full border border-[#ddd3dd] bg-white px-5 text-orchid hover:bg-porcelain disabled:opacity-60">
                {working ? "Searching..." : "Search a wider area"}
              </button>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-orchid">{error}</p>}

        <p className="text-[13px] text-muted">
          Distances are in a straight line. Shops are mapped by volunteers, so hours and stock may be
          out of date. Shop data ©{" "}
          <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
            OpenStreetMap contributors
          </a>.
        </p>
      </div>
    </>
  );
}

// You and the shop on an OpenStreetMap map, joined by a straight dashed line (not a route).
// Leaflet draws into a plain div, so it is created and removed by hand around React.
function ShopMap({ from, to }) {
  const box = useRef(null);

  useEffect(() => {
    const map = L.map(box.current, { scrollWheelZoom: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const you = [from.lat, from.lon];
    const shop = [to.lat, to.lon];
    L.polyline([you, shop], { color: "#7a2e77", weight: 4, dashArray: "2 10", lineCap: "round" }).addTo(map);
    L.circleMarker(you, { radius: 8, color: "#fff", weight: 3, fillColor: "#7a2e77", fillOpacity: 1 })
      .bindTooltip("You").addTo(map);
    L.circleMarker(shop, { radius: 10, color: "#fff", weight: 3, fillColor: "#221a24", fillOpacity: 1 })
      .bindTooltip(to.name).addTo(map);
    map.fitBounds([you, shop], { padding: [36, 36], maxZoom: 17 });
    return () => map.remove();
  }, [from.lat, from.lon, to.lat, to.lon, to.name]);

  return (
    <div ref={box} role="img" aria-label={`Map showing you and ${to.name}`}
      className="isolate h-64 overflow-hidden rounded-[20px] bg-[#ece8e1] lg:h-72" />
  );
}

function PinIcon({ size }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" />
    </svg>
  );
}
