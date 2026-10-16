import type { SupabaseClient } from "@supabase/supabase-js";
import type { Document, Invoice, Payment, Property, Run, Statement, Tenant, Unit } from "./db.js";

export class DbError extends Error {
  status: number;
  constructor(message: string, status = 500) { super(message); this.status = status; }
}

type Res<T> = { data: T | null; error: { message: string; code?: string } | null };
const fail = (e: { message: string; code?: string }) =>
  // 42501 = RLS refused the write, 23503 = foreign key (e.g. unit of another building/org), 23505 = duplicate
  new DbError(e.message, e.code === "42501" ? 403 : e.code === "23503" || e.code === "23505" || e.code === "23514" ? 400 : 500);

/**
 * All data access for one request, as one user, inside one organization.
 * RLS already restricts every read and write to the user's organizations; org_id is still set
 * explicitly on inserts (and the composite foreign keys reject rows pointing into another org).
 */
export class Store {
  readonly sb: SupabaseClient;
  readonly orgId: string;
  constructor(sb: SupabaseClient, orgId: string) { this.sb = sb; this.orgId = orgId; }

  private async many<T>(q: PromiseLike<Res<T[]>>): Promise<T[]> { const { data, error } = await q; if (error) throw fail(error); return data ?? []; }
  private async one<T>(q: PromiseLike<Res<T>>): Promise<T | undefined> { const { data, error } = await q; if (error) throw fail(error); return data ?? undefined; }

  // ---- reads ----
  properties() { return this.many<Property>(this.sb.from("properties").select("*").order("id")); }
  property(id: number) { return this.one<Property>(this.sb.from("properties").select("*").eq("id", id).maybeSingle()); }
  units(propertyId: number) { return this.many<Unit>(this.sb.from("units").select("*").eq("property_id", propertyId).order("id")); }
  unit(id: number) { return this.one<Unit>(this.sb.from("units").select("*").eq("id", id).maybeSingle()); }
  async tenants(propertyId: number) {
    const ids = (await this.units(propertyId)).map((u) => u.id);
    if (!ids.length) return [];
    return this.many<Tenant>(this.sb.from("tenants").select("*").in("unit_id", ids).order("id"));
  }
  tenant(id: number) { return this.one<Tenant>(this.sb.from("tenants").select("*").eq("id", id).maybeSingle()); }
  async allTenants() {
    type Row = Tenant & { units: { label: string; property_id: number; properties: { name: string } | null } | null };
    const rows = await this.many<Row>(this.sb.from("tenants").select("*, units(label, property_id, properties(name))").order("id"));
    return rows.map(({ units, ...t }) => ({ ...t, unit_label: units?.label ?? "", property_id: units?.property_id ?? 0, property_name: units?.properties?.name ?? "" }))
      .sort((a, b) => a.property_name.localeCompare(b.property_name) || a.unit_id - b.unit_id || String(a.move_in).localeCompare(String(b.move_in)));
  }
  invoices(propertyId: number, year?: number) {
    let q = this.sb.from("invoices").select("*").eq("property_id", propertyId);
    if (year) q = q.gte("period_start", `${year}-01-01`).lte("period_start", `${year}-12-31`);
    return this.many<Invoice>(q.order("period_start", { ascending: !!year }).order("id", { ascending: !!year }));
  }
  invoice(id: number) { return this.one<Invoice>(this.sb.from("invoices").select("*").eq("id", id).maybeSingle()); }
  async statements(propertyId: number, year: number) {
    const ts = await this.tenants(propertyId);
    if (!ts.length) return [];
    const unitOf = new Map(ts.map((t) => [t.id, t.unit_id]));
    const rows = await this.many<Statement>(this.sb.from("statements").select("*").in("tenant_id", ts.map((t) => t.id)).eq("year", year));
    return rows.sort((a, b) => (unitOf.get(a.tenant_id)! - unitOf.get(b.tenant_id)!) || a.tenant_id - b.tenant_id);
  }
  statement(id: number) { return this.one<Statement>(this.sb.from("statements").select("*").eq("id", id).maybeSingle()); }
  statementsForTenant(tenantId: number) { return this.many<Statement>(this.sb.from("statements").select("*").eq("tenant_id", tenantId).order("year", { ascending: false })); }
  run(propertyId: number, year: number) { return this.one<Run>(this.sb.from("runs").select("*").eq("property_id", propertyId).eq("year", year).maybeSingle()); }
  payments(tenantId: number) { return this.many<Payment>(this.sb.from("payments").select("*").eq("tenant_id", tenantId).order("paid_on").order("id")); }
  async paymentsForProperty(propertyId: number) {
    const ids = (await this.tenants(propertyId)).map((t) => t.id);
    if (!ids.length) return [];
    return this.many<Payment>(this.sb.from("payments").select("*").in("tenant_id", ids).order("paid_on").order("id"));
  }
  async documents(propertyId: number) {
    const rows = await this.many<Document>(this.sb.from("documents").select("*").eq("property_id", propertyId));
    return rows.sort((a, b) => String(b.doc_date ?? b.created_at).localeCompare(String(a.doc_date ?? a.created_at)) || b.id - a.id);
  }
  document(id: number) { return this.one<Document>(this.sb.from("documents").select("*").eq("id", id).maybeSingle()); }
  organization() { return this.one<Record<string, unknown>>(this.sb.from("organizations").select("*").eq("id", this.orgId).maybeSingle()); }

  // ---- writes ----
  async insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
    const r = await this.one<T>(this.sb.from(table).insert({ ...row, org_id: this.orgId }).select().single());
    if (!r) throw new DbError(`insert into ${table} returned nothing`);
    return r;
  }
  async insertMany(table: string, rows: Record<string, unknown>[]) {
    if (!rows.length) return;
    const { error } = await this.sb.from(table).insert(rows.map((r) => ({ ...r, org_id: this.orgId })));
    if (error) throw fail(error);
  }
  async update<T>(table: string, id: number, patch: Record<string, unknown>): Promise<T | undefined> {
    return this.one<T>(this.sb.from(table).update(patch).eq("id", id).select().maybeSingle());
  }
  async remove(table: string, id: number) {
    const { error } = await this.sb.from(table).delete().eq("id", id);
    if (error) throw fail(error);
  }
  async upsert(table: string, rows: Record<string, unknown>[], onConflict: string) {
    if (!rows.length) return;
    const { error } = await this.sb.from(table).upsert(rows.map((r) => ({ ...r, org_id: this.orgId })), { onConflict });
    if (error) throw fail(error);
  }
  async updateOrganization(patch: Record<string, unknown>) {
    return this.one<Record<string, unknown>>(this.sb.from("organizations").update(patch).eq("id", this.orgId).select().maybeSingle());
  }
  async resetTenantAccess(tenantId: number): Promise<string> {
    const { data, error } = await this.sb.rpc("reset_tenant_access", { p_tenant: tenantId });
    if (error) throw fail(error);
    return data as string;
  }
}
