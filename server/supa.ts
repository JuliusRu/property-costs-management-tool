import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Only the public (anon / publishable) key is used. The service_role key, which bypasses RLS,
// is deliberately NOT part of this app — every query runs as the logged-in user.
const URL = process.env.SUPABASE_URL ?? "";
const KEY = process.env.SUPABASE_ANON_KEY ?? "";
if (!URL || !KEY) console.warn("SUPABASE_URL / SUPABASE_ANON_KEY are not set — the API will refuse requests.");

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

/** Anonymous client: token checks and the narrow public functions (tenant portal, waitlist). */
export const anon: SupabaseClient = createClient(URL || "http://localhost", KEY || "missing", opts);

/** Client acting as the logged-in user: Postgres applies Row Level Security to every query. */
export function userClient(accessToken: string): SupabaseClient {
  return createClient(URL, KEY, { ...opts, global: { headers: { Authorization: `Bearer ${accessToken}` } } });
}

export const supabaseConfig = () => ({ url: URL, anonKey: KEY });
