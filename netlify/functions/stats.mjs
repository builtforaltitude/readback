// Private stats for the owner. Needs the STATS_KEY environment variable.
import { getStore } from "@netlify/blobs";

const etDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
const noStore = { "cache-control": "no-store" };

export default async (req) => {
  const want = process.env.STATS_KEY;
  if (!want) return Response.json({ error: "Add a STATS_KEY environment variable in Netlify first." }, { status: 503, headers: noStore });
  if ((req.headers.get("x-stats-key") || "") !== want) return Response.json({ error: "Wrong password." }, { status: 401, headers: noStore });

  const days = Math.max(1, Math.min(365, Number(new URL(req.url).searchParams.get("days")) || 30));
  const store = getStore("stats");
  const now = Date.now();
  const keys = [];
  for (let i = days - 1; i >= 0; i--) keys.push(etDay(new Date(now - i * 86400000)));
  const uniqDays = [...new Set(keys)];
  const rows = await Promise.all(uniqDays.map(async (day) => ({ day, d: await store.get(`day:${day}`, { type: "json" }) })));

  const sum = { visits: 0, visitors: 0, plays: 0, from: {}, country: {}, region: {}, dev: {}, mode: {}, phase: {} };
  const daily = rows.map(({ day, d }) => {
    if (d) {
      sum.visits += d.visits; sum.visitors += d.uniques.length; sum.plays += d.plays;
      for (const k of ["from", "country", "region", "dev", "mode", "phase"])
        for (const [a, n] of Object.entries(d[k] || {})) sum[k][a] = (sum[k][a] || 0) + n;
    }
    return { day, visits: d?.visits || 0, visitors: d?.uniques.length || 0, plays: d?.plays || 0 };
  });
  return Response.json({ days, daily, sum }, { headers: noStore });
};

export const config = { path: "/api/stats" };
