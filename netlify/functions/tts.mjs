// Readback realistic voices: turns a line of ATC text into speech with Google Cloud Text-to-Speech.
// Every clip is cached, so each phrase is only paid for once, and a daily cap protects the budget.
import { getStore } from "@netlify/blobs";

const VOICES = {
  atc1: "en-US-Wavenet-D",
  atc2: "en-US-Wavenet-J",
  atc3: "en-US-Wavenet-B",
  atcf: "en-US-Wavenet-F",
  pilot1: "en-US-Wavenet-I",
  pilot2: "en-US-Wavenet-A",
  narrator: "en-US-Wavenet-H",
};
const MAX_CHARS = 900;
const ALLOWED = /^[a-zA-Z0-9 ,.'?!:;\-\/()]+$/;

const noStore = { "cache-control": "no-store" };

export default async (req) => {
  const url = new URL(req.url);
  const key = process.env.GOOGLE_TTS_KEY;
  const sa = process.env.GOOGLE_SERVICE_ACCOUNT;
  const cap = Number(process.env.DAILY_CHAR_CAP || 100000);

  if (url.searchParams.has("probe")) {
    return Response.json({ cloud: Boolean(key || sa) }, { headers: noStore });
  }
  if (!key && !sa) return new Response("Voice service not configured", { status: 503, headers: noStore });

  const text = (url.searchParams.get("t") || "").replace(/\s+/g, " ").trim();
  const v = url.searchParams.get("v") || "atc1";
  if (!text || text.length > MAX_CHARS || !ALLOWED.test(text) || !VOICES[v]) {
    return new Response("Bad request", { status: 400, headers: noStore });
  }

  const id = await sha256(`v2|${v}|${text}`);
  const cache = getStore("tts-cache");
  const hit = await cache.get(id, { type: "arrayBuffer" });
  if (hit) return audio(hit);

  const usage = getStore("tts-usage");
  const day = new Date().toISOString().slice(0, 10);
  const used = Number((await usage.get(day)) || 0);
  if (used + text.length > cap) {
    return new Response("Daily voice limit reached", { status: 429, headers: noStore });
  }

  const r = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader(key, sa)) },
    body: JSON.stringify({
      input: { ssml: toSsml(text, v) },
      voice: { languageCode: "en-US", name: VOICES[v] },
      audioConfig: { audioEncoding: "MP3", speakingRate: 1.05 },
    }),
  });
  if (!r.ok) {
    console.error("Google TTS error", r.status, (await r.text()).slice(0, 300));
    return new Response("Voice service error", { status: 502, headers: noStore });
  }
  const { audioContent } = await r.json();
  const bytes = Uint8Array.from(Buffer.from(audioContent, "base64"));

  await usage.set(day, String(used + text.length));
  await cache.set(id, bytes.buffer);
  return audio(bytes.buffer);
};

// Either an API key (GOOGLE_TTS_KEY) or a service account JSON key (GOOGLE_SERVICE_ACCOUNT) works.
let token = null;
async function authHeader(key, sa) {
  if (key) return { "x-goog-api-key": key };
  if (token && token.exp > Date.now() + 60000) return { authorization: `Bearer ${token.value}` };
  const acct = JSON.parse(sa);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
    iss: acct.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const pem = acct.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const k = await crypto.subtle.importKey("pkcs8", Buffer.from(pem, "base64"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, new TextEncoder().encode(unsigned))).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!r.ok) throw new Error(`Token error ${r.status}`);
  const j = await r.json();
  token = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return { authorization: `Bearer ${token.value}` };
}

// A short silent lead-in so phones and Bluetooth headsets don't clip the first word.
function toSsml(text, v) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lead = v === "narrator" ? "450ms" : "250ms";
  return `<speak><break time="${lead}"/>${esc}</speak>`;
}

function audio(buf) {
  return new Response(buf, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "public, max-age=31536000, immutable",
      "netlify-cdn-cache-control": "public, durable, max-age=31536000, immutable",
    },
  });
}

async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const config = { path: "/api/tts" };
