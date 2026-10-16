import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

// The server hands out the project URL and the public (anon) key — no build-time variables needed.
let clientPromise: Promise<SupabaseClient> | null = null;

export function supabase(): Promise<SupabaseClient> {
  clientPromise ??= fetch("/api/public-config").then((r) => r.json()).then((c: { supabase_url: string; supabase_anon_key: string }) => {
    const sb = createClient(c.supabase_url, c.supabase_anon_key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    // Keep the server-side cookie (used for PDF / file links) in sync with the current token.
    sb.auth.onAuthStateChange((event, session) => {
      if (session && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) void syncCookie(session);
      if (event === "SIGNED_OUT") void fetch("/api/session", { method: "DELETE" });
    });
    return sb;
  });
  return clientPromise;
}

async function syncCookie(session: Session) {
  await fetch("/api/session", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
}

export async function accessToken(): Promise<string | null> {
  const sb = await supabase();
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}
