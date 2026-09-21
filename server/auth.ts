import { createHmac, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET must be set (>=16 chars)");
  return s;
};

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

// Sessions are "<role>.<subject>.<expiry>.<hmac>" — no server-side store needed.
export function makeSession(role: "landlord" | "tenant", subject = "0"): string {
  const payload = `${role}.${subject}.${Date.now() + 1000 * 60 * 60 * 12}`; // 12 h
  return `${payload}.${sign(payload)}`;
}

export function verifySession(token: string | undefined, role: "landlord" | "tenant"): { subject: string } | null {
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

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function checkPassword(given: string): boolean {
  const expected = process.env.LANDLORD_PASSWORD ?? "";
  if (!expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function requireLandlord(req: Request, res: Response, next: NextFunction) {
  if (verifySession(readCookie(req, "session"), "landlord")) return next();
  res.status(401).json({ error: "unauthorized" });
}

export function tenantIdFromSession(req: Request): number | null {
  const s = verifySession(readCookie(req, "tenant"), "tenant");
  return s ? Number(s.subject) : null;
}

// Password hashing with scrypt (built in, no dependency). Format: salt:hash, both hex.
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${scryptSync(pw, salt, 64).toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string | null): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const calc = scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  const want = Buffer.from(hashHex, "hex");
  return calc.length === want.length && timingSafeEqual(calc, want);
}
