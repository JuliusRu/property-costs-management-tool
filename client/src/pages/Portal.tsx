import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { Badge, Button, Card, Money, Wordmark } from "../ui";
import { LangSwitch, useT, type Key } from "../i18n";

type Data = Awaited<ReturnType<typeof api.portal>>;

export default function Portal() {
  const t = useT();
  const nav = useNavigate();
  const { token } = useParams();
  const [d, setD] = useState<Data | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "invalid" | "unauth">("loading");
  useEffect(() => {
    (token ? api.portal(token) : api.portalMe())
      .then((x) => { setD(x); setState("ok"); })
      .catch((e) => setState(!token && e instanceof ApiError && e.status === 401 ? "unauth" : "invalid"));
  }, [token]);
  if (state === "unauth") return <Navigate to="/login?as=tenant" />;
  if (state === "invalid") return <div className="p-10 text-center text-mute">{t("p.invalid")}</div>;
  if (!d) return <div className="p-10 text-center text-mute">{t("common.loading")}</div>;
  const fileUrl = (invoiceId: number) => token ? `/api/portal/${token}/invoice/${invoiceId}/file` : `/api/portal/me/invoice/${invoiceId}/file`;

  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-ink text-white"><div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-3"><Wordmark light /><div className="flex items-center gap-3 text-sm"><span className="text-white/60">{t("p.header")}</span><LangSwitch light />{!token && <Button variant="ghost" size="sm" className="border-white/20 bg-transparent text-white hover:bg-white/10" onClick={async () => { await api.tenantLogout(); nav("/login?as=tenant"); }}>{t("p.logout")}</Button>}</div></div></header>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="display text-4xl">{t("p.hello", { n: d.tenant.name.split(" ")[0] })}</h1>
        <p className="mt-2 text-mute">{t("p.sub", { p: d.property.name, u: d.unit.label, a: d.unit.area_sqm, m: (d.tenant.monthly_prepayment_cents / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" }) })}</p>

        {d.statements.length === 0 && <Card className="mt-8 p-8 text-center text-sm text-mute">{t("p.empty")}</Card>}

        {d.statements.map((s) => (
          <Card key={s.id} className="mt-8 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
              <div>
                <div className="text-xl font-bold">{t("p.statement", { y: s.year })}</div>
                <div className="mt-1">{s.sent_at ? <Badge tone="green">{t("p.issued", { d: s.sent_at.slice(0, 10) })}</Badge> : <Badge tone="amber">{t("p.draft")}</Badge>}</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-medium text-mute">{s.balance_cents > 0 ? t("p.youPay") : t("p.youGet")}</div>
                <div className={`display num text-4xl ${s.balance_cents > 0 ? "text-ember" : "text-mint"}`}>{(Math.abs(s.balance_cents) / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</div>
              </div>
            </div>
            <table className="w-full border-t border-line text-sm">
              <thead className="text-left text-xs text-mute"><tr><th className="px-6 py-2 font-medium">{t("p.th.cost")}</th><th className="px-6 py-2 font-medium">{t("p.th.calc")}</th><th className="px-6 py-2 text-right font-medium">{t("p.th.share")}</th></tr></thead>
              <tbody className="divide-y divide-line">
                {s.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="px-6 py-2.5 align-top"><div className="font-medium">{t(`cat.${l.category}` as Key)}</div>
                      <div className="text-xs text-mute">{l.provider} · <a className="font-semibold text-cobalt hover:underline" href={fileUrl(l.invoice_id)} target="_blank" rel="noreferrer">{t("p.seeInvoice")}</a></div></td>
                    <td className="px-6 py-2.5 align-top text-xs"><div className="text-mute">{t(`key.${l.allocation_key}` as Key)}</div><div className="num mt-0.5 text-ink-soft">{l.formula}</div></td>
                    <td className="num px-6 py-2.5 text-right align-top font-semibold"><Money cents={l.share_cents} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-line text-sm">
                <tr><td className="px-6 py-2" colSpan={2}>{t("p.yourCosts")}</td><td className="num px-6 py-2 text-right"><Money cents={s.total_cents} /></td></tr>
                <tr><td className="px-6 py-2" colSpan={2}>{t("p.yourPrepaid")}</td><td className="num px-6 py-2 text-right">− <Money cents={s.prepaid_cents} /></td></tr>
                <tr className="font-bold"><td className="px-6 py-3" colSpan={2}>{s.balance_cents > 0 ? t("p.due") : t("p.refund")}</td><td className="num px-6 py-3 text-right"><Money cents={Math.abs(s.balance_cents)} /></td></tr>
              </tfoot>
            </table>
          </Card>
        ))}
        <p className="mt-8 text-center text-xs text-mute">{t("p.legal")}</p>
      </div>
    </div>
  );
}
