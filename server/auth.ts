import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { anon, userClient } from "./supa.js";
import { Store } from "./store.js";

// ───────────── landlords: Supabase Auth ─────────────
// The browser signs in with Supabase and sends its access token as "Authorization: Bearer …".
// For plain GET links (PDFs, invoice files opened in a new tab) the same token is also accepted
// from an HttpOnly cookie — but never for writes, so another site cannot trigger changes (CSRF).

export type Ctx = { user: User; sb: SupabaseClient; orgId: string; st: Store; token: string };
declare module "express-serve-static-core" { interface Request { ctx: Ctx } }

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = bearer(req) ?? (req.method === "GET" ? readCookie(req, "sb_token") : undefined);
  if (!token) return res.status(401).json({ error: "unauthorized" });
  const { data, error } = await anon.auth.getUser(token); // verified by Supabase Auth, not just decoded
  if (error || !data.user) return res.status(401).json({ error: "unauthorized" });
  const sb = userClient(token);
  const { data: m } = await sb.from("memberships").select("org_id").eq("user_id", data.user.id).order("created_at").limit(1).maybeSingle();
  if (!m) return res.status(403).json({ error: "no organization for this account" });
  req.ctx = { user: data.user, sb, orgId: m.org_id as string, st: new Store(sb, m.org_id as string), token };
  next();
}

export const cookieFlags = () => `HttpOnly; SameSite=Lax; Path=/${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;

// ───────────── tenants: signed session cookie carrying the portal token ─────────────

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (>=16 chars)");
  return s;
};
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

// "<role>.<subject>.<expiry>.<hmac>" — no server-side store needed.
export function makeSession(role: "tenant", subject: string): string {
  const payload = `${role}.${subject}.${Date.now() + 1000 * 60 * 60 * 12}`; // 12 h
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined, role: "tenant"): { subject: string } | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const [r, subject, expStr] = payload.split(".");
  const exp = Number(expStr);
  if (r !== role || !Number.isFinite(exp) || exp <= Date.now()) return null;
  return { subject };
}

export function tenantTokenFromSession(req: Request): string | null {
  return verifySession(readCookie(req, "tenant"), "tenant")?.subject ?? null;
}
