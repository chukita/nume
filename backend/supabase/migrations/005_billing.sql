-- NuMe — Fase 6: suscripciones, trial y estados de billing
-- ─────────────────────────────────────────────────────────────────

-- Columnas nuevas en tenants para tracking de plan + suscripción
alter table tenants
  add column plan_status            text        not null default 'active'
    check (plan_status in ('active', 'trialing', 'past_due', 'canceled')),
  add column trial_ends_at          timestamptz,
  add column plan_expires_at        timestamptz,
  add column billing_provider       text,        -- 'mercadopago' por ahora; extensible
  add column billing_customer_id    text,
  add column billing_subscription_id text;

-- Índice para encontrar suscripciones por ID externo (webhook handler)
create index if not exists tenants_billing_subscription_idx
  on tenants (billing_subscription_id)
  where billing_subscription_id is not null;

-- ─── Actualizar onboard_tenant: arrancar con trial de 30 días ─────
-- Cualquier signup nuevo entra como Pro en modo "trialing" hasta
-- trial_ends_at. Después la lógica de la app lo trata como Free
-- si no upgradeó.
create or replace function onboard_tenant(
  p_user_id uuid,
  p_slug     text,
  p_name     text
) returns uuid language plpgsql security definer as $$
declare
  new_tenant_id uuid;
begin
  if exists (select 1 from tenants where slug = p_slug) then
    raise exception 'slug_taken' using hint = 'Ese slug ya está en uso';
  end if;

  insert into tenants (slug, name, plan, plan_status, trial_ends_at)
    values (p_slug, p_name, 'pro', 'trialing', now() + interval '30 days')
    returning id into new_tenant_id;

  insert into users (id, tenant_id, role)
    values (p_user_id, new_tenant_id, 'owner');

  insert into tables (tenant_id, number)
    select new_tenant_id, gs from generate_series(1, 10) gs;

  return new_tenant_id;
end;
$$;

revoke execute on function onboard_tenant(uuid, text, text) from public, anon, authenticated;
grant  execute on function onboard_tenant(uuid, text, text) to service_role;
