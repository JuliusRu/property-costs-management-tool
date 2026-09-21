import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, Card, Field, inputCls, Wordmark } from "../ui";
import { LangSwitch, useT } from "../i18n";

const DEMO = { landlord: "demo", tenant: { email: "lena.hoffmann@example.com", password: "demo1234" }, register: { email: "oeztuerk@example.com", code: "OEZT2025", password: "demo1234" } };

export default function Login() {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState<"landlord" | "tenant">(params.get("as") === "tenant" ? "tenant" : "landlord");
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [demo, setDemo] = useState(false);
  const [pw, setPw] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // Demo mode (dev, or DEMO_MODE=1 on the server): prefill so nobody has to type during a demo.
  useEffect(() => { api.publicConfig().then((c) => setDemo(c.demo)).catch(() => {}); }, []);
  useEffect(() => {
    if (!demo) return;
    setPw(DEMO.landlord);
    if (mode === "signin") { setEmail(DEMO.tenant.email); setPassword(DEMO.tenant.password); setCode(""); }
    else { setEmail(DEMO.register.email); setCode(DEMO.register.code); setPassword(DEMO.register.password); }
  }, [demo, mode]);

  const tab = (r: typeof role) => `flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${role === r ? "bg-ink text-white" : "text-ink-soft hover:bg-surface"}`;
  const submit = async (fn: () => Promise<unknown>, to: string, wrong: string) => {
    setErr(""); setBusy(true);
    try { await fn(); nav(to); } catch (e) { setErr((e as Error).message === "Failed to fetch" ? wrong : ((e as Error).message.startsWith("wrong") || (e as Error).message === "Unauthorized") ? wrong : (e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <Card className="w-full max-w-sm p-8">
        <div className="flex items-center justify-between"><Link to="/"><Wordmark /></Link><LangSwitch /></div>
        <div className="mt-6 flex gap-1 rounded-xl border border-line p-1">
          <button className={tab("landlord")} onClick={() => { setRole("landlord"); setErr(""); }}>{t("login.landlord")}</button>
          <button className={tab("tenant")} onClick={() => { setRole("tenant"); setErr(""); }}>{t("login.tenant")}</button>
        </div>
        <p className="mb-5 mt-4 text-sm text-mute">{role === "landlord" ? t("login.landlord.sub") : t("login.tenant.sub")}</p>

        {role === "landlord" ? (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => api.login(pw), "/app", t("login.wrong")); }}>
            <Field label={t("login.password")}><input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" /></Field>
            {err && <p className="text-sm text-ember">{err}</p>}
            <Button className="w-full" type="submit" disabled={busy}>{t("login.submit")}</Button>
          </form>
        ) : mode === "signin" ? (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => api.tenantLogin(email, password), "/portal", t("login.wrong.tenant")); }}>
            <Field label={t("login.email")}><input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="email" /></Field>
            <Field label={t("login.password")}><input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
            {err && <p className="text-sm text-ember">{err}</p>}
            <Button className="w-full" type="submit" disabled={busy}>{t("login.submit")}</Button>
            <button type="button" className="w-full text-center text-sm font-semibold text-cobalt hover:underline" onClick={() => { setMode("register"); setErr(""); }}>{t("login.mode.register")}</button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(() => api.tenantRegister(email, code, password), "/portal", t("login.wrong.tenant")); }}>
            <Field label={t("login.email")}><input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="email" /></Field>
            <Field label={t("login.code")} hint={t("login.code.hint")}><input className={inputCls + " uppercase tracking-widest"} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" placeholder="ABCD2345" /></Field>
            <Field label={t("login.newPassword")}><input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} /></Field>
            {err && <p className="text-sm text-ember">{err}</p>}
            <Button className="w-full" type="submit" disabled={busy}>{t("login.register")}</Button>
            <button type="button" className="w-full text-center text-sm font-semibold text-cobalt hover:underline" onClick={() => { setMode("signin"); setErr(""); }}>{t("login.mode.signin")}</button>
          </form>
        )}
        {demo && <p className="mt-6 text-xs text-mute">{t("login.demo")}</p>}
      </Card>
    </div>
  );
}
