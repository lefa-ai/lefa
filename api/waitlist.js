import { Redis } from "@upstash/redis";

// Env vars are injected automatically when you connect Upstash in the Vercel
// Storage tab. The fallback chain covers both the Upstash Marketplace names
// (UPSTASH_REDIS_REST_*), Vercel's prefixed KV names, and the legacy Vercel
// KV names (KV_REST_API_*).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
let redis;

export default async function handler(req, res) {
  redis ??= new Redis(redisConfig());

  return handleWaitlist(req, res, redis);
}

export function redisConfig(env = process.env) {
  return {
    url:
      env.KV_REST_API_URL ||
      env.UPSTASH_REDIS_REST_URL ||
      env.UPSTASH_REDIS_REST_KV_REST_API_URL,
    token:
      env.KV_REST_API_TOKEN ||
      env.UPSTASH_REDIS_REST_TOKEN ||
      env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN,
  };
}

export async function handleWaitlist(req, res, store) {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // Vercel parses JSON bodies automatically; guard against a raw string too.
  const body = typeof req.body === "string" ? safeParse(req.body) : req.body || {};
  const email = String(body.email || "").trim().toLowerCase();

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: "invalid_email" });
  }

  try {
    // One hash keyed by email → dedupes on re-submit and keeps the first-seen
    // timestamp. hlen gives the running signup count.
    await store.hsetnx("waitlist", email, new Date().toISOString());
    const count = await store.hlen("waitlist");
    return res.status(200).json({ ok: true, count });
  } catch (err) {
    return res.status(500).json({ error: "store_failed" });
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
