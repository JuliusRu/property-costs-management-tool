import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Button, Card, Field, inputCls, Wordmark } from "../ui";
import { LangSwitch, useT } from "../i18n";

export default function Login() {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState<"landlord" | "tenant">(params.get("as") === "tenant" ? "tenant" : "landlord");
  const [pw, setPw] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const tab = (r: typeof role) => `flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${role === r ? "bg-ink text-white" : "text-ink-soft hover:bg-surface"}`;

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
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault(); setErr(""); setBusy(true);
            try { await api.login(pw); nav("/app"); } catch { setErr(t("login.wrong")); }
            setBusy(false);
          }}>
            <Field label={t("login.password")}><input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="current-password" /></Field>
            {err && <p className="text-sm text-ember">{err}</p>}
            <Button className="w-full" type="submit" disabled={busy}>{t("login.submit")}</Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={async (e) => {
            e.preventDefault(); setErr(""); setBusy(true);
            try { await api.tenantLogin(email, code); nav("/portal"); } catch { setErr(t("login.wrong.tenant")); }
            setBusy(false);
          }}>
            <Field label={t("login.email")}><input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="email" /></Field>
            <Field label={t("login.code")}><input className={inputCls + " uppercase tracking-widest"} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" placeholder="ABCD2345" /></Field>
            {err && <p className="text-sm text-ember">{err}</p>}
            <Button className="w-full" type="submit" disabled={busy}>{t("login.submit")}</Button>
          </form>
        )}
        <p className="mt-6 text-xs text-mute">{t("login.demo")}</p>
      </Card>
    </div>
  );
}
