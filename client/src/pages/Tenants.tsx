import { useEffect, useMemo, useState } from "react";
import { api, type Property, type TenantRow } from "../api";
import { Badge, Card, Empty, inputCls, Money, PageTitle } from "../ui";
import { useT } from "../i18n";
import { PaymentControl } from "./Statements";
import { DataTable, type Column } from "../table";

export default function Tenants({ properties, select }: { properties: Property[]; select: (id: number) => void }) {
  const t = useT();
  const [rows, setRows] = useState<TenantRow[]>([]);
  const [q, setQ] = useState("");
  const [building, setBuilding] = useState("");
  const [status, setStatus] = useState("");
  const load = () => api.tenantsAll().then(setRows);
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) =>
      (!building || String(r.property_id) === building) &&
      (!status || (status === "open" ? r.latest?.payment_status === "open" && r.latest.balance_cents !== 0 : r.latest && r.latest.payment_status !== "open")) &&
      (!n || [r.name, r.email, r.property_name, r.unit_label].some((v) => v.toLowerCase().includes(n))));
  }, [rows, q, building, status]);

  const openIn = rows.reduce((s, r) => s + (r.latest?.payment_status === "open" && r.latest.balance_cents > 0 ? r.latest.balance_cents : 0), 0);
  const openOut = rows.reduce((s, r) => s + (r.latest?.payment_status === "open" && r.latest.balance_cents < 0 ? -r.latest.balance_cents : 0), 0);

  return (
    <>
      <PageTitle title={t("tn.title")} sub={t("tn.sub")} />
      {rows.length === 0 ? <Empty title={t("tn.empty")}>{t("tn.empty.sub")}</Empty> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Card className="p-4"><div className="text-xs font-medium text-mute">{t("tn.count", { n: rows.length })}</div><div className="display num mt-1 text-2xl">{rows.length}</div></Card>
            <Card className="p-4"><div className="text-xs font-medium text-mute">{t("tn.sumOpenIn")}</div><div className="display num mt-1 text-2xl text-ember"><Money cents={openIn} /></div></Card>
            <Card className="p-4"><div className="text-xs font-medium text-mute">{t("tn.sumOpenOut")}</div><div className="display num mt-1 text-2xl text-mint"><Money cents={openOut} /></div></Card>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input className={inputCls + " max-w-xs"} placeholder={t("tn.search")} value={q} onChange={(e) => setQ(e.target.value)} />
            <select className={inputCls + " !w-auto"} value={building} onChange={(e) => setBuilding(e.target.value)}><option value="">{t("tn.allBuildings")}</option>{properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <select className={inputCls + " !w-auto"} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">{t("tn.status.all")}</option><option value="open">{t("tn.status.open")}</option><option value="settled">{t("tn.status.settled")}</option></select>
          </div>
          <Card>
            <DataTable<TenantRow> rows={filtered} rowKey={(r) => r.id} minWidth={960} defaultSort={{ key: "where", dir: 1 }} emptyText={t("d.noMatch")} columns={[
              { key: "name", label: t("tn.th.name"), sort: (r) => r.name, render: (r) => <><div className="font-semibold">{r.name}</div><div className="text-xs text-mute">{r.email}</div>{r.lease_rules && <Badge tone={r.lease.confirmed ? "green" : "red"}>{r.lease.confirmed ? t("lease.confirmed") : t("lease.unconfirmed")}</Badge>}</> },
              { key: "where", label: t("tn.th.where"), sort: (r) => `${r.property_name} ${r.unit_label}`, render: (r) => <><button className="font-medium text-cobalt hover:underline" onClick={() => select(r.property_id)} title={t("tn.goto")}>{r.property_name}</button><div className="text-xs text-mute">{r.unit_label}</div></> },
              { key: "period", label: t("tn.th.period"), sort: (r) => r.move_in ?? "", nowrap: true, render: (r) => <span className="num text-xs text-mute">{r.move_in ? t("tn.since", { d: r.move_in }) : "—"}{r.move_out && <div>{t("tn.until", { d: r.move_out })}</div>}</span> },
              { key: "prepay", label: t("tn.th.prepay"), align: "right", sort: (r) => r.monthly_prepayment_cents, render: (r) => <><Money cents={r.monthly_prepayment_cents} /><span className="text-xs text-mute">/{t("common.month")}</span></> },
              { key: "statement", label: t("tn.th.statement"), align: "right", sort: (r) => r.latest?.balance_cents ?? null, render: (r) => r.latest ? <><Money cents={r.latest.balance_cents} signed /><div className="text-xs text-mute">{r.latest.year}{r.latest.sent_at ? ` · ${t("s.sentOn", { d: r.latest.sent_at.slice(0, 10) })}` : ` · ${t("s.notSent")}`}</div></> : <span className="text-xs text-mute">{t("tn.none")}</span> },
              { key: "payment", label: t("tn.th.payment"), sort: (r) => r.latest?.payment_status ?? "", render: (r) => r.latest && r.latest.balance_cents !== 0 ? <PaymentControl sid={r.latest.id} balance={r.latest.balance_cents} status={r.latest.payment_status} paidAt={r.latest.paid_at} onChange={load} compact /> : <span className="text-xs text-mute">—</span> },
              { key: "portal", label: t("tn.th.portal"), sort: (r) => (r.registered ? 1 : 0), render: (r) => <Badge tone={r.registered ? "green" : "amber"}>{r.registered ? t("b.tenant.registered") : t("b.tenant.notRegistered")}</Badge> },
            ] satisfies Column<TenantRow>[]} />
          </Card>
        </>
      )}
    </>
  );
}
