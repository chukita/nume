-- NuMe — Fase 2: auth + RLS de escritura

-- ─── Tabla users (vincula auth.users ↔ tenants) ────────────────
create table users (
  id         uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

alter table users enable row level security;

-- Un usuario solo ve su propio registro
create policy "users: read own"
  on users for select
  using (id = auth.uid());

-- ─── JWT claim: exponer tenant_id en el token ───────────────────
-- Supabase llama a esta función al generar cada JWT.
-- El claim queda en app_metadata y es accesible como auth.jwt()->'app_metadata'->>'tenant_id'
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare
  claims   jsonb;
  tid      uuid;
begin
  select tenant_id into tid from users where id = (event->>'user_id')::uuid;
  claims := event->'claims';
  if tid is not null then
    claims := jsonb_set(claims, '{app_metadata,tenant_id}', to_jsonb(tid::text));
  end if;
  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Activar el hook en Supabase Dashboard:
-- Authentication → Hooks → Custom Access Token → apuntar a public.custom_access_token_hook

-- ─── Helper: leer tenant_id desde el JWT ───────────────────────
create or replace function auth_tenant_id() returns uuid language sql stable as $$
  select (auth.jwt()->'app_metadata'->>'tenant_id')::uuid;
$$;

-- ─── RLS de escritura para tenants propietarios ─────────────────

-- TENANTS: el owner puede actualizar su propio tenant
create policy "owner: update tenant"
  on tenants for update
  using (id = auth_tenant_id())
  with check (id = auth_tenant_id());

-- CATEGORIES
create policy "owner: insert category"
  on categories for insert
  with check (tenant_id = auth_tenant_id());

create policy "owner: update category"
  on categories for update
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

create policy "owner: delete category"
  on categories for delete
  using (tenant_id = auth_tenant_id());

-- ITEMS
create policy "owner: insert item"
  on items for insert
  with check (tenant_id = auth_tenant_id());

create policy "owner: update item"
  on items for update
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

create policy "owner: delete item"
  on items for delete
  using (tenant_id = auth_tenant_id());

-- PROMOTIONS
create policy "owner: insert promotion"
  on promotions for insert
  with check (tenant_id = auth_tenant_id());

create policy "owner: update promotion"
  on promotions for update
  using (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

create policy "owner: delete promotion"
  on promotions for delete
  using (tenant_id = auth_tenant_id());

-- TABLES (mesas)
create policy "owner: manage tables"
  on tables for all
  using  (tenant_id = auth_tenant_id())
  with check (tenant_id = auth_tenant_id());

-- ─── Registro de un nuevo tenant (onboarding) ──────────────────
-- Llamar como RPC desde el backend después del signup en Supabase Auth.
-- Corre con SECURITY DEFINER para poder insertar en users sin RLS.
create or replace function onboard_tenant(
  p_user_id uuid,
  p_slug     text,
  p_name     text
) returns uuid language plpgsql security definer as $$
declare
  new_tenant_id uuid;
begin
  -- Validar que el slug no esté tomado
  if exists (select 1 from tenants where slug = p_slug) then
    raise exception 'slug_taken' using hint = 'Ese slug ya está en uso';
  end if;

  insert into tenants (slug, name)
    values (p_slug, p_name)
    returning id into new_tenant_id;

  insert into users (id, tenant_id, role)
    values (p_user_id, new_tenant_id, 'owner');

  -- Crear 10 mesas por defecto
  insert into tables (tenant_id, number)
    select new_tenant_id, gs from generate_series(1, 10) gs;

  return new_tenant_id;
end;
$$;

-- Solo el service_role puede llamar a onboard_tenant
revoke execute on function onboard_tenant(uuid, text, text) from public, anon, authenticated;
grant  execute on function onboard_tenant(uuid, text, text) to service_role;
