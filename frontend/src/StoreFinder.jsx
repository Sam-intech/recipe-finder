import { useState } from "react";
import { findStores } from "./api.js";

// Browsers only allow location on https:// pages (and localhost), and only after the user
// says yes. Each failure gets its own message so people know what to do next.
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser can't share your location, so we can't look for shops."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      timeout: 10000,
      maximumAge: 5 * 60 * 1000,  // a position from the last 5 minutes is fine
    });
  });
}

function locationMessage(err) {
  // GeolocationPositionError codes: 1 = denied, 2 = unavailable, 3 = timed out.
  if (err.code === 1) {
    return "Location is blocked for this site. Allow it in your browser's site settings, then try again.";
  }
  if (err.code === 2) {
    return "Your device couldn't work out where you are. Try again with a better signal.";
  }
  if (err.code === 3) return "Finding your location took too long. Try again.";
  return err.message;
}

// UK and US readers expect miles, so use those for en-GB and en-US browsers.
const useMiles = () => /^en-(GB|US)/i.test(navigator.language || "");

function formatDistance(metres) {
  if (useMiles()) {
    const miles = metres / 1609.34;
    return miles < 0.1 ? "under 0.1 miles" : miles.toFixed(1) + " miles";
  }
  return metres < 1000 ? Math.round(metres / 10) * 10 + " m" : (metres / 1000).toFixed(1) + " km";
}

const mapLink = (store) => `https://www.google.com/maps/search/?api=1&query=${store.lat},${store.lon}`;

export default function StoreFinder({ items }) {
  const [phase, setPhase] = useState("idle");  // idle, locating, searching, done
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  async function search() {
    setError("");
    setResult(null);
    setPhase("locating");
    let position;
    try {
      position = await getPosition();
    } catch (err) {
      setError(locationMessage(err));
      setPhase("idle");
      return;
    }
    setPhase("searching");
    try {
      const { latitude, longitude } = position.coords;
      setResult(await findStores({ lat: latitude, lon: longitude }, items));
      setPhase("done");
    } catch (err) {
      setError(err.message);
      setPhase("idle");
    }
  }

  const working = phase === "locating" || phase === "searching";

  return (
    <div className="mt-4 rounded-[24px] bg-porcelain p-5">
      <p className="font-display text-xl font-semibold">Where to buy</p>

      {phase !== "done" && (
        <>
          <p className="mt-1 text-muted">
            Find shops near you that are likely to sell what's on your list. Your location is only
            used to search for shops.
          </p>
          <button onClick={search} disabled={working}
            className="mt-4 min-h-12 rounded-full bg-orchid px-6 font-semibold text-white hover:bg-ink disabled:opacity-60">
            {working ? "Working..." : "Find stores near me"}
          </button>
        </>
      )}

      <p role="status" className="mt-3 text-muted">
        {phase === "locating" && "Waiting for your location. Your browser may ask for permission."}
        {phase === "searching" && "Looking for shops nearby..."}
      </p>
      {error && <p role="alert" className="mt-3 text-orchid">{error}</p>}

      {result && <Results result={result} onAgain={search} />}
    </div>
  );
}

function Results({ result, onAgain }) {
  const radius = formatDistance(result.radius_m).replace(/\.0/, "");
  return (
    <div>
      <div className="space-y-6">
        {result.groups.map((group) => (
          <section key={group.category}>
            <h3 className="font-display text-lg font-semibold">{group.label}</h3>
            <p className="text-sm text-muted">For: {group.items.join(", ")}</p>
            {group.note && <p className="mt-1 text-sm text-muted">{group.note}</p>}

            {group.stores.length === 0 ? (
              <p className="mt-2">None found within {radius}.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded-[18px] bg-white">
                {group.stores.map((store, i) => (
                  <li key={store.name + i} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{store.name}</p>
                      {store.address && <p className="text-sm text-muted">{store.address}</p>}
                      {store.opening_hours && (
                        <p className="text-sm text-muted">Hours: {store.opening_hours}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm text-muted">{formatDistance(store.distance_m)}</p>
                      <a href={mapLink(store)} target="_blank" rel="noopener"
                        className="inline-flex min-h-11 items-center text-sm text-orchid underline underline-offset-4">
                        Open in Maps
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <p className="mt-5 text-sm text-muted">
        Distances are in a straight line. Shops are mapped by volunteers, so hours and stock may be
        out of date. Shop data ©{" "}
        <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
          OpenStreetMap contributors
        </a>.
      </p>
      <button onClick={onAgain}
        className="mt-3 min-h-11 rounded-full border border-[#ddd3dd] bg-white px-5 text-sm hover:text-orchid">
        Search again
      </button>
    </div>
  );
}
