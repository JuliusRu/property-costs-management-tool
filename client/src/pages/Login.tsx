import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Button, Card, Field, inputCls, Wordmark } from "../ui";

export default function Login() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const nav = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-6">
      <Card className="w-full max-w-sm p-8">
        <Link to="/"><Wordmark /></Link>
        <p className="mb-6 mt-3 text-sm text-mute">Landlord sign-in. Tenants use the link from their statement.</p>
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault(); setErr("");
          try { await api.login(pw); nav("/app"); } catch { setErr("That password is not right."); }
        }}>
          <Field label="Password"><input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></Field>
          {err && <p className="text-sm text-ember">{err}</p>}
          <Button className="w-full" type="submit">Sign in</Button>
        </form>
      </Card>
    </div>
  );
}
