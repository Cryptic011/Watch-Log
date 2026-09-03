import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-watchlog-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const PIN_ITERATIONS = 350000;
const SESSION_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MAINTENANCE_ADMIN_HASH = "a9db2ce561a8b3d65766ef4d26ee235e58c269407104d13865546c5d5299420b";
const DEFAULT_MAINTENANCE_MESSAGE = "Watched Logger is currently under maintenance. Please try again shortly.";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function normalizeEmail(v: unknown) { return String(v ?? "").trim().toLowerCase(); }
function validEmail(v: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function validPin(v: unknown) { return /^\d{4}$/.test(String(v ?? "")); }
function b64(bytes: Uint8Array) { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(value: string) { const s = atob(value); const out = new Uint8Array(s.length); for (let i=0;i<s.length;i++) out[i] = s.charCodeAt(i); return out; }
async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,"0")).join("");
}
async function derivePin(pin: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PIN_ITERATIONS, hash: "SHA-256" }, material, 256);
  return b64(new Uint8Array(bits));
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i=0;i<a.length;i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0;
}
function randomToken() { return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2,"0")).join(""); }

async function readMaintenance() {
  const { data, error } = await db
    .from("watchlog_app_config")
    .select("maintenance_enabled,maintenance_message,updated_at")
    .eq("singleton", true)
    .single();
  if (error) throw error;
  return {
    enabled: data.maintenance_enabled === true,
    message: String(data.maintenance_message || DEFAULT_MAINTENANCE_MESSAGE),
    updatedAt: data.updated_at,
  };
}

async function isMaintenanceAdmin(accountId: string) {
  const { data, error } = await db
    .from("watchlog_pin_accounts")
    .select("email")
    .eq("id", accountId)
    .single();
  if (error || !data) return false;
  const candidate = await sha256(`watchlog-maintenance-admin:${normalizeEmail(data.email)}`);
  return safeEqual(candidate, MAINTENANCE_ADMIN_HASH);
}

async function createSession(accountId: string) {
  const token = randomToken();
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const { error } = await db.from("watchlog_pin_sessions").insert({ token_hash: tokenHash, account_id: accountId, expires_at: expires });
  if (error) throw error;
  return { token, expiresAt: expires };
}

async function getSession(req: Request) {
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const token = req.headers.get("x-watchlog-session")?.trim() || bearer || "";
  if (!token) return null;
  const tokenHash = await sha256(token);
  const { data, error } = await db.from("watchlog_pin_sessions").select("token_hash,account_id,expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    await db.from("watchlog_pin_sessions").delete().eq("token_hash", tokenHash);
    return null;
  }
  db.from("watchlog_pin_sessions").update({ last_seen_at: new Date().toISOString() }).eq("token_hash", tokenHash).then(() => {});
  return { accountId: data.account_id as string, tokenHash };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }
  const action = String(body?.action || "");

  try {
    if (action === "app_status") {
      const maintenance = await readMaintenance();
      return json({ ok: true, maintenance: maintenance.enabled, message: maintenance.message, updatedAt: maintenance.updatedAt });
    }

    if (action === "register") {
      const maintenance = await readMaintenance();
      if (maintenance.enabled) {
        return json({ error: maintenance.message, code: "maintenance", maintenance: true }, 503);
      }
      const email = normalizeEmail(body.email);
      const pin = String(body.pin ?? "");
      const displayName = String(body.displayName ?? "User").trim().slice(0, 64) || "User";
      if (!validEmail(email)) return json({ error: "Enter a valid email address." }, 400);
      if (!validPin(pin)) return json({ error: "PIN must be exactly 4 digits." }, 400);

      const { data: existing } = await db.from("watchlog_pin_accounts").select("id").eq("email", email).maybeSingle();
      if (existing) return json({ error: "An account already exists for that email. Sign in instead.", code: "account_exists" }, 409);

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const pinHash = await derivePin(pin, salt);
      const { data: account, error } = await db.from("watchlog_pin_accounts").insert({ email, display_name: displayName, pin_hash: pinHash, pin_salt: b64(salt) }).select("id,email,display_name").single();
      if (error) throw error;
      await db.from("watchlog_pin_library").upsert({ account_id: account.id, items: Array.isArray(body.items) ? body.items : [], updated_at: new Date().toISOString() });
      const session = await createSession(account.id);
      return json({ ok: true, account: { id: account.id, email: account.email, displayName: account.display_name }, sessionToken: session.token, expiresAt: session.expiresAt });
    }

    if (action === "login") {
      const maintenance = await readMaintenance();
      const email = normalizeEmail(body.email);
      const ownerCandidate = await sha256(`watchlog-maintenance-admin:${email}`);
      const isOwnerLogin = safeEqual(ownerCandidate, MAINTENANCE_ADMIN_HASH);
      if (maintenance.enabled && !isOwnerLogin) {
        return json({ error: maintenance.message, code: "maintenance", maintenance: true }, 503);
      }
      const pin = String(body.pin ?? "");
      if (!validEmail(email) || !validPin(pin)) return json({ error: "Email or PIN is incorrect.", code: "invalid_login" }, 401);

      const { data: account, error } = await db.from("watchlog_pin_accounts").select("id,email,display_name,pin_hash,pin_salt,failed_attempts,locked_until").eq("email", email).maybeSingle();
      if (error || !account) return json({ error: "Email or PIN is incorrect.", code: "invalid_login" }, 401);

      if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
        const retryAfter = Math.max(1, Math.ceil((new Date(account.locked_until).getTime() - Date.now()) / 1000));
        return json({ error: `Too many incorrect PIN attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`, code: "locked", retryAfter }, 429);
      }

      const candidate = await derivePin(pin, unb64(account.pin_salt));
      if (!safeEqual(candidate, account.pin_hash)) {
        const failures = Number(account.failed_attempts || 0) + 1;
        const shouldLock = failures >= MAX_FAILED_ATTEMPTS;
        await db.from("watchlog_pin_accounts").update({
          failed_attempts: shouldLock ? 0 : failures,
          locked_until: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null,
          updated_at: new Date().toISOString(),
        }).eq("id", account.id);
        if (shouldLock) return json({ error: `Too many incorrect PIN attempts. Account locked for ${LOCK_MINUTES} minutes.`, code: "locked", retryAfter: LOCK_MINUTES * 60 }, 429);
        return json({ error: "Email or PIN is incorrect.", code: "invalid_login" }, 401);
      }

      await db.from("watchlog_pin_accounts").update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }).eq("id", account.id);
      const session = await createSession(account.id);
      const { data: library } = await db.from("watchlog_pin_library").select("items,updated_at").eq("account_id", account.id).maybeSingle();
      return json({ ok: true, account: { id: account.id, email: account.email, displayName: account.display_name }, items: Array.isArray(library?.items) ? library!.items : [], sessionToken: session.token, expiresAt: session.expiresAt });
    }

    const session = await getSession(req);
    if (!session) return json({ error: "Session expired. Sign in again.", code: "session_expired" }, 401);

    if (action === "maintenance_admin_status" || action === "set_maintenance") {
      if (!(await isMaintenanceAdmin(session.accountId))) {
        return json({ error: "This account cannot manage maintenance mode.", code: "forbidden" }, 403);
      }
      if (action === "set_maintenance") {
        const enabled = body.enabled === true;
        const message = String(body.message || DEFAULT_MAINTENANCE_MESSAGE).trim().slice(0, 240);
        if (message.length < 8) return json({ error: "Maintenance message must be at least 8 characters." }, 400);
        const { error } = await db
          .from("watchlog_app_config")
          .update({ maintenance_enabled: enabled, maintenance_message: message, updated_at: new Date().toISOString() })
          .eq("singleton", true);
        if (error) throw error;
      }
      const maintenance = await readMaintenance();
      return json({ ok: true, canManage: true, maintenance: maintenance.enabled, message: maintenance.message, updatedAt: maintenance.updatedAt });
    }

    if (action === "load") {
      const [{ data: account, error: aerr }, { data: library, error: lerr }] = await Promise.all([
        db.from("watchlog_pin_accounts").select("id,email,display_name").eq("id", session.accountId).single(),
        db.from("watchlog_pin_library").select("items,updated_at").eq("account_id", session.accountId).maybeSingle(),
      ]);
      if (aerr) throw aerr; if (lerr) throw lerr;
      return json({ ok: true, account: { id: account.id, email: account.email, displayName: account.display_name }, items: Array.isArray(library?.items) ? library!.items : [], updatedAt: library?.updated_at || null });
    }

    if (action === "save") {
      if (!Array.isArray(body.items)) return json({ error: "Invalid library." }, 400);
      const serialized = JSON.stringify(body.items);
      if (serialized.length > 3_000_000) return json({ error: "Library is too large to sync." }, 413);
      const { error } = await db.from("watchlog_pin_library").upsert({ account_id: session.accountId, items: body.items, updated_at: new Date().toISOString() });
      if (error) throw error;
      return json({ ok: true, updatedAt: new Date().toISOString() });
    }

    if (action === "profile") {
      const displayName = String(body.displayName ?? "").trim().slice(0,64);
      if (!displayName) return json({ error: "Name is required." }, 400);
      const { error } = await db.from("watchlog_pin_accounts").update({ display_name: displayName, updated_at: new Date().toISOString() }).eq("id", session.accountId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "change_pin") {
      const pin = String(body.pin ?? "");
      if (!validPin(pin)) return json({ error: "PIN must be exactly 4 digits." }, 400);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const pinHash = await derivePin(pin, salt);
      const { error } = await db.from("watchlog_pin_accounts").update({ pin_hash: pinHash, pin_salt: b64(salt), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }).eq("id", session.accountId);
      if (error) throw error;
      await db.from("watchlog_pin_sessions").delete().eq("account_id", session.accountId).neq("token_hash", session.tokenHash);
      return json({ ok: true });
    }

    if (action === "logout") {
      await db.from("watchlog_pin_sessions").delete().eq("token_hash", session.tokenHash);
      return json({ ok: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: "WatchLog cloud service error." }, 500);
  }
});
