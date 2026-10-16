import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { supabase } from "../supabase";
import { Button, Card, Field, inputCls, Notice, Wordmark } from "../ui";
import { LangSwitch, useT } from "../i18n";

type LandlordMode = "signin" | "signup" | "forgot";

export default function Login() {
  const t = useT();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState<"landlord" | "tenant">(params.get("as") === "tenant" ? "tenant" : "landlord");
  const [lMode, setLMode] = useState<LandlordMode>(params.get("mode") === "signup" ? "signup" : "signin");
  const [tMode, setTMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const tab = (r: typeof role) => `flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${role === r ? "bg-ink text-white" : "text-ink-soft hover:bg-surface"}`;
  const reset = () => { setErr(""); setInfo(""); };
  const run = async (fn: () => Promise<void>) => { reset(); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } setBusy(false); };

  // ---- landlord (Supabase Auth) ----
  const landlordSignIn = () => run(async () => {
    const sb = await supabase();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message.includes("Email not confirmed") ? t("auth.notConfirmed") : t("login.wrong"));
    nav("/app");
  });
  const landlordSignUp = () => run(async () => {
    if (password.length < 8) throw new Error(t("auth.pwShort"));
    const sb = await supabase();
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: `${location.origin}/app`, data: { org_name: orgName.trim() } } });
    if (error) throw new Error(error.message);
    if (data.session) nav("/app");            // e-mail confirmation switched off → signed in right away
    else setInfo(t("auth.checkInbox", { e: email }));
  });
  const landlordForgot = () => run(async () => {
    const sb = await supabase();
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/reset-password` });
    if (error) throw new Error(error.message);
    setInfo(t("auth.resetSent", { e: email }));
  });

  // ---- tenant (portal) ----
  const tenantSubmit = () => run(async () => {
    try { await (tMode === "signin" ? api.tenantLogin(email, password) : api.tenantRegister(email, code, password)); nav("/portal"); }
    catch (e) { throw new Error((e as Error).message.startsWith("wrong") ? t("login.wrong.tenant") : (e as Error).message); }
  });

  const link = "w-full text-center text-sm font-semibold text-cobalt hover:underline";

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <Card className="w-full max-w-sm p-8">
        <div className="flex items-center justify-between"><Link to="/"><Wordmark /></Link><LangSwitch /></div>
        <div className="mt-6 flex gap-1 rounded-xl border border-line p-1">
          <button className={tab("landlord")} onClick={() => { setRole("landlord"); reset(); }}>{t("login.landlord")}</button>
          <button className={tab("tenant")} onClick={() => { setRole("tenant"); reset(); }}>{t("login.tenant")}</button>
        </div>
        <p className="mb-5 mt-4 text-sm text-mute">
          {role === "tenant" ? t("login.tenant.sub") : lMode === "signup" ? t("auth.signup.sub") : lMode === "forgot" ? t("auth.forgot.sub") : t("login.landlord.sub")}
        </p>

        {info && <Notice tone="green">{info}</Notice>}

        {role === "landlord" ? (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (lMode === "signin") landlordSignIn(); else if (lMode === "signup") landlordSignUp(); else landlordForgot(); }}>
            {lMode === "signup" && <Field label={t("auth.orgName")} hint={t("auth.orgName.hint")}><input className={inputCls} value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder={t("auth.orgName.ph")} /></Field>}
            <Field label={t("login.email")}><input type="email" required className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="username" /></Field>
            {lMode !== "forgot" && <Field label={lMode === "signup" ? t("login.newPassword") : t("login.password")}><input type="password" required className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={lMode === "signup" ? "new-password" : "current-password"} minLength={lMode === "signup" ? 8 : undefined} /></Field>}
            {err && <p className="text-sm text-ember">{err}</p>}
            <Button className="w-full" type="submit" disabled={busy}>{lMode === "signup" ? t("auth.signup") : lMode === "forgot" ? t("auth.sendReset") : t("login.submit")}</Button>
            {lMode === "signin" && <>
              <button type="button" className={link} onClick={() => { setLMode("signup"); reset(); }}>{t("auth.toSignup")}</button>
              <button type="button" className="w-full text-center text-xs text-mute hover:underline" onClick={() => { setLMode("forgot"); reset(); }}>{t("auth.toForgot")}</button>
            </>}
            {lMode !== "signin" && <button type="button" className={link} onClick={() => { setLMode("signin"); reset(); }}>{t("auth.toSignin")}</button>}
          </form>
        ) : (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); tenantSubmit(); }}>
            <Field label={t("login.email")}><input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoFocus autoComplete="email" /></Field>
            {tMode === "register" && <Field label={t("login.code")} hint={t("login.code.hint")}><input className={inputCls + " uppercase tracking-widest"} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" placeholder="ABCD2345" /></Field>}
            <Field label={tMode === "register" ? t("login.newPassword") : t("login.password")}><input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={tMode === "register" ? "new-password" : "current-password"} minLength={tMode === "register" ? 8 : undefined} /></Field>
            {err && <p className="text-sm text-ember">{err}</p>}
            <Button className="w-full" type="submit" disabled={busy}>{tMode === "register" ? t("login.register") : t("login.submit")}</Button>
            <button type="button" className={link} onClick={() => { setTMode(tMode === "signin" ? "register" : "signin"); reset(); }}>{tMode === "signin" ? t("login.mode.register") : t("login.mode.signin")}</button>
          </form>
        )}
      </Card>
    </div>
  );
}

/** Target of the "reset password" e-mail: Supabase signs the user in from the link, then they choose a new password. */
export function ResetPassword() {
  const t = useT();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <Card className="w-full max-w-sm p-8">
        <Link to="/"><Wordmark /></Link>
        <p className="mb-5 mt-4 text-sm text-mute">{t("auth.newPw.sub")}</p>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setErr(""); setBusy(true);
          const sb = await supabase();
          const { error } = await sb.auth.updateUser({ password: pw });
          setBusy(false);
          if (error) setErr(error.message); else nav("/app");
        }}>
          <Field label={t("login.newPassword")}><input type="password" required minLength={8} className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="new-password" /></Field>
          {err && <p className="text-sm text-ember">{err}</p>}
          <Button className="w-full" type="submit" disabled={busy}>{t("auth.savePw")}</Button>
        </form>
      </Card>
    </div>
  );
}
