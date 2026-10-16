-- Billnest — multi-tenant schema with Row Level Security.
--
-- Model: every user belongs to one or more ORGANIZATIONS (a landlord, a property manager, co-owners).
-- Every business table carries org_id; one RLS policy per table says "members of that org only".
-- Child rows reference their parent by (id, org_id), so a row can never point into another org.
--
-- Tenants of the landlord are NOT Supabase users. They reach their data only through the narrow
-- SECURITY DEFINER functions at the bottom (portal by secret token, register with code, log in).

create extension if not exists pgcrypto with schema extensions;

-- ───────────────────────── organizations & memberships ─────────────────────────

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Meine Verwaltung',
  -- sender block for statements (Absender, Bankverbindung)
  landlord_name text,
  landlord_address text,
  iban text,
  contact_email text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- SECURITY DEFINER so the check itself is not subject to RLS on memberships (avoids recursion).
create or replace function public.is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships where org_id = p_org and user_id = auth.uid());
$$;

-- Every new sign-up gets its own organization and is its owner.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  insert into public.organizations (name, contact_email)
  values (coalesce(nullif(new.raw_user_meta_data->>'org_name', ''), 'Meine Verwaltung'), new.email)
  returning id into v_org;
  insert into public.memberships (org_id, user_id, role) values (v_org, new.id, 'owner');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 8-character registration codes without look-alike characters (0/O, 1/I/L).
create or replace function public.new_access_code() returns text
language plpgsql volatile as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(8);
  code text := '';
begin
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(b, i) % 31) + 1, 1);
  end loop;
  return code;
end $$;

-- ───────────────────────── business tables ─────────────────────────

create table public.properties (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  address text not null default '',
  country text not null default 'DE',
  settings_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (id, org_id)
);
create index properties_org_idx on public.properties(org_id);

create table public.units (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  property_id bigint not null,
  label text not null,
  unit_type text not null default 'residential' check (unit_type in ('residential', 'commercial', 'garage')),
  area_sqm double precision not null default 0,
  mea double precision not null default 0,
  persons integer not null default 1,
  heating_kwh double precision not null default 0,
  water_m3 double precision not null default 0,
  unique (id, org_id),
  foreign key (property_id, org_id) references public.properties(id, org_id) on delete cascade
);
create index units_property_idx on public.units(property_id);

create table public.tenants (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  unit_id bigint not null,
  name text not null,
  email text not null,
  monthly_prepayment_cents integer not null default 0,
  move_in date,
  move_out date,
  portal_token text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  access_code text not null default public.new_access_code(),
  registered_at timestamptz,
  lease_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (unit_id, org_id) references public.units(id, org_id) on delete cascade
);
create index tenants_unit_idx on public.tenants(unit_id);
create index tenants_email_idx on public.tenants(lower(email));

-- Tenant password hashes live in their own table WITHOUT any RLS policy:
-- nobody can read them through the API, not even the landlord. Only the functions below touch it.
create table public.tenant_credentials (
  tenant_id bigint primary key references public.tenants(id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table public.invoices (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  property_id bigint not null,
  unit_id bigint,
  provider text not null default '',
  category text not null,
  description text,
  amount_cents integer not null,
  period_start date not null,
  period_end date not null,
  allocation_key text not null,
  pool text not null default 'all' check (pool in ('all', 'residential', 'commercial')),
  allocable smallint not null default 1 check (allocable in (0, 1)),
  non_allocable_cents integer not null default 0,
  non_allocable_reason text,
  co2_cents integer not null default 0,
  energy_kwh double precision not null default 0,
  source text not null default 'manual',
  file_name text,
  ai_confidence double precision,
  ai_notes text,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (property_id, org_id) references public.properties(id, org_id) on delete cascade,
  foreign key (unit_id, org_id) references public.units(id, org_id) on delete set null (unit_id)
);
create index invoices_property_idx on public.invoices(property_id, period_start);

create table public.payments (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  tenant_id bigint not null,
  paid_on date not null,
  amount_cents integer not null,
  note text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, org_id) references public.tenants(id, org_id) on delete cascade
);
create index payments_tenant_idx on public.payments(tenant_id, paid_on);

create table public.runs (
  org_id uuid not null,
  property_id bigint not null,
  year integer not null,
  summary_json jsonb not null,
  checks_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (property_id, year),
  foreign key (property_id, org_id) references public.properties(id, org_id) on delete cascade
);

create table public.statements (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  tenant_id bigint not null,
  year integer not null,
  total_cents integer not null,
  prepaid_cents integer not null,
  balance_cents integer not null,
  suggested_prepayment_cents integer not null default 0,
  payment_status text not null default 'open' check (payment_status in ('open', 'paid', 'refunded', 'waived')),
  paid_at date,
  paid_cents integer,
  payment_note text,
  lines_json jsonb not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (tenant_id, year),
  foreign key (tenant_id, org_id) references public.tenants(id, org_id) on delete cascade
);

create table public.documents (
  id bigint generated always as identity primary key,
  org_id uuid not null,
  property_id bigint not null,
  kind text not null default 'other',
  title text not null,
  provider text,
  doc_date date,
  amount_cents integer,
  tenant_id bigint,
  invoice_id bigint,
  file_name text not null,
  mime text not null,
  size_bytes integer not null,
  notes text,
  created_at timestamptz not null default now(),
  foreign key (property_id, org_id) references public.properties(id, org_id) on delete cascade,
  foreign key (tenant_id, org_id) references public.tenants(id, org_id) on delete set null (tenant_id),
  foreign key (invoice_id, org_id) references public.invoices(id, org_id) on delete set null (invoice_id)
);
create index documents_property_idx on public.documents(property_id);

create table public.waitlist (
  id bigint generated always as identity primary key,
  email text not null unique,
  units integer,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Row Level Security ─────────────────────────

alter table public.organizations      enable row level security;
alter table public.memberships        enable row level security;
alter table public.properties         enable row level security;
alter table public.units              enable row level security;
alter table public.tenants            enable row level security;
alter table public.tenant_credentials enable row level security;  -- no policy on purpose
alter table public.invoices           enable row level security;
alter table public.payments           enable row level security;
alter table public.runs               enable row level security;
alter table public.statements         enable row level security;
alter table public.documents          enable row level security;
alter table public.waitlist           enable row level security;  -- no policy: written via join_waitlist()

create policy "members read their organization" on public.organizations
  for select to authenticated using (public.is_member(id));
create policy "members update their organization" on public.organizations
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy "see own memberships" on public.memberships
  for select to authenticated using (user_id = auth.uid() or public.is_member(org_id));

-- One rule per business table: read and write only inside your own organization.
create policy "org members" on public.properties for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "org members" on public.units      for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "org members" on public.tenants    for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "org members" on public.invoices   for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "org members" on public.payments   for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "org members" on public.runs       for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "org members" on public.statements for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));
create policy "org members" on public.documents  for all to authenticated using (public.is_member(org_id)) with check (public.is_member(org_id));

-- Defence in depth: the anonymous role gets no table access at all.
revoke all on all tables in schema public from anon;

-- ───────────────────────── tenant & public functions ─────────────────────────
-- These run as the table owner (SECURITY DEFINER) and are deliberately narrow:
-- each one takes a secret (portal token, registration code, password) and returns only what belongs to it.

-- Everything a tenant may see, by the 128-bit token in their portal link.
create or replace function public.portal_by_token(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object('name', t.name, 'email', t.email, 'monthly_prepayment_cents', t.monthly_prepayment_cents),
    'unit', to_jsonb(u) - 'org_id',
    'property', jsonb_build_object('id', p.id, 'name', p.name, 'address', p.address),
    'statements', coalesce((
      select jsonb_agg((to_jsonb(s) - 'lines_json' - 'org_id') || jsonb_build_object('lines', s.lines_json) order by s.year desc)
      from public.statements s where s.tenant_id = t.id
    ), '[]'::jsonb)
  )
  from public.tenants t
  join public.units u on u.id = t.unit_id
  join public.properties p on p.id = u.property_id
  where length(p_token) = 32 and t.portal_token = p_token;
$$;

-- File name of an invoice the tenant may open (same building only), else null.
create or replace function public.portal_invoice_file(p_token text, p_invoice_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select i.file_name
  from public.tenants t
  join public.units u on u.id = t.unit_id
  join public.invoices i on i.property_id = u.property_id and i.org_id = t.org_id
  where length(p_token) = 32 and t.portal_token = p_token and i.id = p_invoice_id;
$$;

-- One-time registration: e-mail + code from the statement + chosen password → portal token.
create or replace function public.tenant_register(p_email text, p_code text, p_password text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_id bigint; v_token text; v_registered timestamptz;
begin
  if length(coalesce(p_password, '')) < 8 then raise exception 'password too short'; end if;
  select id, portal_token, registered_at into v_id, v_token, v_registered
  from public.tenants
  where lower(email) = lower(trim(p_email))
    and access_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
  limit 1;
  if v_id is null then return null; end if;
  if v_registered is not null then raise exception 'already registered'; end if;
  insert into public.tenant_credentials (tenant_id, password_hash)
  values (v_id, extensions.crypt(p_password, extensions.gen_salt('bf', 10)))
  on conflict (tenant_id) do update set password_hash = excluded.password_hash, created_at = now();
  update public.tenants set registered_at = now() where id = v_id;
  return v_token;
end $$;

-- Login: e-mail + password → portal token (null if wrong). bcrypt keeps guessing slow.
create or replace function public.tenant_login(p_email text, p_password text) returns text
language sql stable security definer set search_path = public as $$
  select t.portal_token
  from public.tenants t
  join public.tenant_credentials c on c.tenant_id = t.id
  where lower(t.email) = lower(trim(p_email))
    and c.password_hash = extensions.crypt(p_password, c.password_hash)
  limit 1;
$$;

-- Landlord issues a new registration code; the old password stops working.
create or replace function public.reset_tenant_access(p_tenant bigint) returns text
language plpgsql volatile security definer set search_path = public as $$
declare v_org uuid; v_code text := public.new_access_code();
begin
  select org_id into v_org from public.tenants where id = p_tenant;
  if v_org is null or not public.is_member(v_org) then raise exception 'not allowed'; end if;
  delete from public.tenant_credentials where tenant_id = p_tenant;
  update public.tenants set access_code = v_code, registered_at = null where id = p_tenant;
  return v_code;
end $$;

-- Landing page waitlist.
create or replace function public.join_waitlist(p_email text, p_units integer) returns void
language sql volatile security definer set search_path = public as $$
  insert into public.waitlist (email, units) values (lower(trim(p_email)), p_units)
  on conflict (email) do update set units = excluded.units;
$$;

-- Execute rights: nothing by default, then exactly what each role needs.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.new_access_code() to authenticated;
grant execute on function public.reset_tenant_access(bigint) to authenticated;
grant execute on function public.portal_by_token(text) to anon, authenticated;
grant execute on function public.portal_invoice_file(text, bigint) to anon, authenticated;
grant execute on function public.tenant_register(text, text, text) to anon, authenticated;
grant execute on function public.tenant_login(text, text) to anon, authenticated;
grant execute on function public.join_waitlist(text, integer) to anon, authenticated;
