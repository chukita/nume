-- NuMe — Fase 5: analytics de eventos

-- ─── Tabla de eventos ──────────────────────────────────────────
create table events (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references tenants(id) on delete cascade,
  type       text        not null check (type in (
               'menu_view', 'item_view', 'favorite', 'search', 'promo_click'
             )),
  payload    jsonb       not null default '{}',
  -- payload ejemplos:
  --   item_view:   { "item_id": "...", "item_name": "Bondiola", "category": "principales" }
  --   favorite:    { "item_id": "...", "item_name": "Bondiola", "action": "add"|"remove" }
  --   search:      { "query": "veggie" }
  --   promo_click: { "promo_id": "...", "promo_title": "Happy hour" }
  --   menu_view:   { "table_number": 12 }
  created_at timestamptz not null default now()
);

-- Índices para las queries de analytics
create index on events (tenant_id, type, created_at desc);
create index on events (tenant_id, created_at desc);

-- ─── RLS ───────────────────────────────────────────────────────
alter table events enable row level security;

-- Inserción pública (el frontend no está autenticado)
-- Se limita desde el backend validando tenant_id por slug
create policy "public insert events"
  on events for insert
  with check (true);

-- Lectura: solo el owner del tenant
create policy "owner read events"
  on events for select
  using (tenant_id = auth_tenant_id());

-- ─── Vistas para analytics ─────────────────────────────────────

-- Vistas diarias por tenant (últimos 30 días)
create or replace view analytics_daily as
select
  tenant_id,
  type,
  date_trunc('day', created_at at time zone 'America/Argentina/Buenos_Aires') as day,
  count(*) as total
from events
where created_at >= now() - interval '30 days'
group by 1, 2, 3;

-- Top items vistos (últimos 30 días)
create or replace view analytics_top_items as
select
  tenant_id,
  payload->>'item_id'   as item_id,
  payload->>'item_name' as item_name,
  count(*) as views
from events
where type = 'item_view'
  and created_at >= now() - interval '30 days'
group by 1, 2, 3
order by views desc;

-- Top búsquedas (últimos 30 días)
create or replace view analytics_top_searches as
select
  tenant_id,
  lower(payload->>'query') as query,
  count(*) as total
from events
where type = 'search'
  and payload->>'query' is not null
  and length(payload->>'query') > 1
  and created_at >= now() - interval '30 days'
group by 1, 2
order by total desc;
