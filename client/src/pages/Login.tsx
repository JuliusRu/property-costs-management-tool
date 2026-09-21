import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { APP_NAME, Button, Card, Field, inputCls } from "../ui";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6">
          <div className="text-2xl font-bold tracking-tight">{APP_NAME}</div>
          <p className="mt-1 text-sm text-slate-500">Operating cost statements on autopilot. Landlord login.</p>
        </div>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setErr("");
          try { await api.login(pw); nav("/"); } catch { setErr("Wrong password"); }
        }}>
          <Field label="Password"><input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></Field>
          {err && <p className="text-sm text-red-600">{err}</p>}
          <Button className="w-full justify-center" type="submit">Sign in</Button>
        </form>
      </Card>
    </div>
  );
}
