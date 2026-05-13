-- NuMe — schema inicial
-- Fase 1: tenants, categories, items, promotions, tables

-- ─── Extensiones ───────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Tenants ───────────────────────────────────────────────────
create table tenants (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  logo_url      text,
  primary_color text default '#d8ff3a',
  plan          text not null default 'free' check (plan in ('free', 'pro')),
  active        bool not null default true,
  created_at    timestamptz not null default now()
);

-- ─── Mesas ─────────────────────────────────────────────────────
create table tables (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  number      int  not null,
  qr_token    text unique not null default encode(gen_random_bytes(6), 'hex'),
  created_at  timestamptz not null default now(),
  unique (tenant_id, number)
);

-- ─── Categorías ────────────────────────────────────────────────
create table categories (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  label       text not null,
  image_url   text,
  image_pos   text default 'center',
  featured    bool not null default false,
  position    int  not null default 0,
  active      bool not null default true,
  created_at  timestamptz not null default now()
);

-- ─── Platos ────────────────────────────────────────────────────
create table items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  category_id  uuid not null references categories(id) on delete cascade,
  name         text not null,
  description  text,
  price        numeric(10,2) not null,
  image_url    text,
  tags         text[] not null default '{}',  -- 'veg','new','spicy','promo','out'
  position     int  not null default 0,
  active       bool not null default true,
  created_at   timestamptz not null default now()
);

-- ─── Promociones ───────────────────────────────────────────────
create table promotions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  tag         text not null,
  title       text not null,
  subtitle    text,
  time_label  text,
  style       text not null default 'dark' check (style in ('dark','fluo','coral','bank')),
  details     jsonb,          -- reglas extendidas (ej. BNA+)
  position    int  not null default 0,
  active      bool not null default true,
  starts_at   timestamptz,
  ends_at     timestamptz,
  created_at  timestamptz not null default now()
);

-- ─── Índices de búsqueda / performance ─────────────────────────
create index on categories (tenant_id, position) where active = true;
create index on items      (tenant_id, category_id, position) where active = true;
create index on promotions (tenant_id, position) where active = true;

-- ─── Row Level Security ─────────────────────────────────────────
-- Lectura pública: cualquier visitante puede leer datos activos
-- Escritura: solo el usuario autenticado dueño del tenant (Fase 2)

alter table tenants    enable row level security;
alter table categories enable row level security;
alter table items      enable row level security;
alter table promotions enable row level security;
alter table tables     enable row level security;

-- Tenants: visible si está activo
create policy "public read tenants"
  on tenants for select using (active = true);

-- Categories: visible si pertenece a un tenant activo
create policy "public read categories"
  on categories for select
  using (
    active = true
    and exists (select 1 from tenants t where t.id = tenant_id and t.active = true)
  );

-- Items: ídem
create policy "public read items"
  on items for select
  using (
    active = true
    and exists (select 1 from tenants t where t.id = tenant_id and t.active = true)
  );

-- Promotions: visible si está activo y dentro del rango de fechas
create policy "public read promotions"
  on promotions for select
  using (
    active = true
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >= now())
    and exists (select 1 from tenants t where t.id = tenant_id and t.active = true)
  );

-- Tables: visible públicamente (necesario para resolver qr_token)
create policy "public read tables"
  on tables for select
  using (
    exists (select 1 from tenants t where t.id = tenant_id and t.active = true)
  );

-- ─── Datos de ejemplo (tenant de desarrollo) ───────────────────
insert into tenants (slug, name, primary_color) values
  ('demo', 'NuMe Demo', '#d8ff3a');

-- Guardar el id para los inserts siguientes
do $$
declare
  tid uuid;
  cat_principales uuid;
  cat_entradas    uuid;
  cat_pizzas      uuid;
  cat_tragos      uuid;
begin
  select id into tid from tenants where slug = 'demo';

  -- Mesas
  insert into tables (tenant_id, number) values
    (tid, 1),(tid, 2),(tid, 3),(tid, 4),(tid, 5),
    (tid, 6),(tid, 7),(tid, 8),(tid, 9),(tid, 10),
    (tid, 11),(tid, 12);

  -- Categorías
  insert into categories (id, tenant_id, label, image_url, featured, position) values
    (gen_random_uuid(), tid, 'Principales', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=320&q=80&auto=format&fit=crop', true, 0) returning id into cat_principales;

  insert into categories (id, tenant_id, label, image_url, position) values
    (gen_random_uuid(), tid, 'Entradas',   'https://images.unsplash.com/photo-1601001435957-74f0958a93c5?w=320&q=80&auto=format&fit=crop', 1) returning id into cat_entradas;

  insert into categories (id, tenant_id, label, image_url, position) values
    (gen_random_uuid(), tid, 'Pizzas',     'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=320&q=80&auto=format&fit=crop', 2) returning id into cat_pizzas;

  insert into categories (id, tenant_id, label, image_url, position) values
    (gen_random_uuid(), tid, 'Tragos',     'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=320&q=80&auto=format&fit=crop', 3) returning id into cat_tragos;

  -- Platos - Principales
  insert into items (tenant_id, category_id, name, description, price, image_url, tags, position) values
    (tid, cat_principales, 'Bondiola braseada',  'Cocción lenta 6h con puré rústico y cebollas caramelizadas.', 9500,  'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&q=80&auto=format&fit=crop', '{promo}', 0),
    (tid, cat_principales, 'Milanesa napolitana', 'Jamón, queso, salsa de tomate y papas fritas crocantes.',    8900,  'https://images.unsplash.com/photo-1559847844-5315695dadae?w=400&q=80&auto=format&fit=crop', '{}',      1),
    (tid, cat_principales, 'Salmón grillado',     'Con quinoa, palta y vinagreta de limón.',                    11200, 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&q=80&auto=format&fit=crop', '{new}',   2),
    (tid, cat_principales, 'Risotto de hongos',   'Arroz arborio, portobellos, parmesano reggiano.',            7800,  'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=400&q=80&auto=format&fit=crop', '{veg}',   3);

  -- Platos - Entradas
  insert into items (tenant_id, category_id, name, description, price, image_url, tags, position) values
    (tid, cat_entradas, 'Provoleta',       'Queso provolone grillado con orégano y tomate.',        4200, 'https://images.unsplash.com/photo-1559561853-08451507cbe7?w=400&q=80&auto=format&fit=crop', '{}',            0),
    (tid, cat_entradas, 'Empanadas (3u)',  'Carne cortada a cuchillo, jamón y queso o verdura.',    3800, 'https://images.unsplash.com/photo-1601001435957-74f0958a93c5?w=400&q=80&auto=format&fit=crop', '{}',            1),
    (tid, cat_entradas, 'Burrata',         'Tomates confitados, albahaca, pan de masa madre.',      5400, 'https://images.unsplash.com/photo-1572441713132-c542fc4fe282?w=400&q=80&auto=format&fit=crop', '{veg,new}',     2);

  -- Tragos
  insert into items (tenant_id, category_id, name, description, price, image_url, tags, position) values
    (tid, cat_tragos, 'Negroni',        'Gin, vermouth rosso, campari, naranja.',           4800, 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?w=400&q=80&auto=format&fit=crop', '{}',       0),
    (tid, cat_tragos, 'Aperol Spritz',  'Aperol, prosecco, soda.',                          4500, 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=400&q=80&auto=format&fit=crop', '{promo}',  1),
    (tid, cat_tragos, 'Gin Tonic NuMe', 'Gin de la casa, tónica, pepino y enebro.',         4900, 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=400&q=80&auto=format&fit=crop', '{new}',    2);

  -- Pizzas
  insert into items (tenant_id, category_id, name, description, price, image_url, tags, position) values
    (tid, cat_pizzas, 'Muzzarella',    'Salsa de tomate, muzzarella, oliva.',         5800, 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?w=400&q=80&auto=format&fit=crop', '{}',       0),
    (tid, cat_pizzas, 'Cuatro quesos', 'Muzza, parmesano, roquefort, provolone.',     7400, 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&q=80&auto=format&fit=crop', '{veg}',    1),
    (tid, cat_pizzas, 'Diavola',       'Salame picante, muzza, ají molido.',          7900, 'https://images.unsplash.com/photo-1604068549290-dea0e4a305ca?w=400&q=80&auto=format&fit=crop', '{spicy}',  2);

  -- Promociones
  insert into promotions (tenant_id, tag, title, subtitle, time_label, style, details, position) values
    (tid, 'BNA+ MODO', '30% de reintegro', 'Miércoles, pagando con QR vía BNA+ o MODO.', 'miércoles · hasta 31/05/26', 'bank',
      '{"headline":"30","tagline":"todos los miércoles · hasta 31/05/26","hook":"Junto a BNA+ te traemos los miércoles de 30% de reintegro.","rules":[{"ok":true,"text":"Válido SOLO con pago por QR"},{"ok":true,"text":"App MODO o BNA+ vinculada"},{"ok":false,"text":"Tope $12.000 por semana"},{"ok":"min","text":"Mínimo de compra: $80.000"}],"footer":"Exclusivo BNA+ · MODO · VISA / Mastercard"}',
      0),
    (tid, 'HOY',  'Menú ejecutivo',    'Entrada + principal + bebida.',                       '12 — 15 h',           'dark',  null, 1),
    (tid, '2X1',  'Happy hour',        'En todos los tragos seleccionados.',                  '18 — 20 h',           'fluo',  null, 2),
    (tid, '-20%', 'Pizzas miércoles',  'Toda la sección de pizzas, salón y delivery.',        'todos los miércoles', 'coral', null, 3);
end $$;
