// Readback visit counter. Records visits and practice, without cookies,
// without storing IP addresses, and without exact locations.
import { getStore } from "@netlify/blobs";

const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|monitor/i;
const clip = (s, n = 40) => String(s || "").replace(/[^\w .:\/-]/g, "").slice(0, n);
const etDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

export default async (req, context) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const ua = req.headers.get("user-agent") || "";
  if (BOTS.test(ua)) return new Response(null, { status: 204 });

  let body;
  try { body = JSON.parse(await req.text()); } catch { return new Response("Bad request", { status: 400 }); }
  const events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
  if (!events.length) return new Response(null, { status: 204 });

  const day = etDay();
  const store = getStore("stats");
  const key = `day:${day}`;
  const d = (await store.get(key, { type: "json" })) || {
    visits: 0, uniques: [], plays: 0, from: {}, country: {}, region: {}, dev: {}, mode: {}, phase: {},
  };
  const inc = (obj, k, n = 1) => { if (!k) return; obj[k] = (obj[k] || 0) + n; };

  const geo = context.geo || {};
  const country = clip(geo.country?.name || geo.country?.code || "Unknown");
  const region = geo.country?.code === "US" ? clip(geo.subdivision?.name || geo.subdivision?.code || "") : "";
  const visitor = await hash(`${day}|${context.ip || ""}|${ua}`);

  for (const e of events) {
    if (e.e === "visit") {
      d.visits++;
      if (!d.uniques.includes(visitor) && d.uniques.length < 20000) d.uniques.push(visitor);
      inc(d.from, clip(e.from || "direct", 30).toLowerCase());
      inc(d.country, country);
      if (region) inc(d.region, region);
      inc(d.dev, e.dev === "phone" ? "phone" : "computer");
    } else if (e.e === "play") {
      const n = Math.max(1, Math.min(100, Number(e.n) || 1));
      d.plays += n;
      inc(d.mode, clip(e.mode, 20), n);
      if (e.phase) inc(d.phase, clip(e.phase, 20), n);
    }
  }
  await store.setJSON(key, d);
  return new Response(null, { status: 204 });
};

async function hash(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 12).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export const config = { path: "/api/hit" };
