import { Hono } from 'hono';
import { requireAuth, requireTenant, getServiceClient } from '../middleware/auth.js';
import { effectivePlan, FREE_LIMITS } from '../lib/plan.js';

const admin = new Hono();

// Todos los endpoints admin requieren JWT válido.
// Los que además necesitan tenant agregan `requireTenant` después (ver más abajo).
admin.use('*', requireAuth);
admin.use('*', async (c, next) => {
  // /onboard es el único endpoint que se puede llamar SIN tenant
  if (c.req.path.endsWith('/onboard')) return next();
  return requireTenant(c, next);
});

// ─────────── Auth / Onboarding ───────────────────────────────────

// POST /api/admin/onboard
// Body: { slug, name }
// Crea tenant + fila en public.users + mesas por defecto para el usuario
// recién registrado. Solo funciona si el usuario todavía no tiene tenant.
admin.post('/onboard', async (c) => {
  // Este endpoint lo llama el frontend justo después del signup de Supabase Auth
  const { slug, name } = await c.req.json();
  const tenantId = c.get('tenantId');

  if (tenantId) {
    return c.json({ error: 'Este usuario ya tiene un tenant' }, 409);
  }

  const userId = c.get('user').id;
  const svc = getServiceClient();

  const { data, error } = await svc.rpc('onboard_tenant', {
    p_user_id: userId,
    p_slug: slug,
    p_name: name,
  });

  if (error) {
    if (error.message.includes('slug_taken')) {
      return c.json({ error: 'El slug ya está en uso' }, 409);
    }
    console.error('onboard_tenant error:', error);
    return c.json({ error: 'Error al crear el local' }, 500);
  }

  return c.json({ tenant_id: data }, 201);
});

// ─────────── Tenant ──────────────────────────────────────────────

// GET /api/admin/tenant
admin.get('/tenant', async (c) => {
  const db = c.get('userClient');
  const { data, error } = await db
    .from('tenants')
    .select('id, slug, name, logo_url, primary_color, plan, plan_status, trial_ends_at, plan_expires_at, active')
    .eq('id', c.get('tenantId'))
    .single();
  if (error) return c.json({ error: error.message }, 500);
  const eff = effectivePlan(data);
  return c.json({ ...data, effective_plan: eff.plan, is_trial: eff.isTrial });
});

// GET /api/admin/plan
// Estado actual del plan + uso (items vs límite) para la pantalla "Mi plan".
admin.get('/plan', async (c) => {
  const db  = c.get('userClient');
  const tid = c.get('tenantId');

  const { data: tenant, error } = await db
    .from('tenants')
    .select('plan, plan_status, trial_ends_at, plan_expires_at, billing_provider, billing_subscription_id')
    .eq('id', tid)
    .single();
  if (error) return c.json({ error: error.message }, 500);

  const { count: itemCount } = await db
    .from('items')
    .select('*', { count: 'exact', head: true })
    .eq('tenant_id', tid);

  const eff = effectivePlan(tenant);
  return c.json({
    plan: tenant.plan,
    plan_status: tenant.plan_status,
    effective_plan: eff.plan,
    is_trial: eff.isTrial,
    trial_ends_at: tenant.trial_ends_at,
    plan_expires_at: tenant.plan_expires_at,
    expires_at: eff.expiresAt,
    item_count: itemCount || 0,
    item_limit: eff.plan === 'pro' ? null : FREE_LIMITS.items,
    has_payment_method: !!tenant.billing_subscription_id,
  });
});

// PATCH /api/admin/tenant
admin.patch('/tenant', async (c) => {
  const db = c.get('userClient');
  const body = await c.req.json();
  const allowed = ['name', 'logo_url', 'primary_color'];
  const update = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  );
  const { data, error } = await db
    .from('tenants')
    .update(update)
    .eq('id', c.get('tenantId'))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// ─────────── Categorías ──────────────────────────────────────────

// GET /api/admin/categories
admin.get('/categories', async (c) => {
  const db = c.get('userClient');
  const { data, error } = await db
    .from('categories')
    .select('id, label, image_url, image_pos, featured, position, active')
    .eq('tenant_id', c.get('tenantId'))
    .order('position');
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// POST /api/admin/categories
admin.post('/categories', async (c) => {
  const db = c.get('userClient');
  const body = await c.req.json();
  const { data, error } = await db
    .from('categories')
    .insert({ ...body, tenant_id: c.get('tenantId') })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

// PATCH /api/admin/categories/:id
admin.patch('/categories/:id', async (c) => {
  const db = c.get('userClient');
  const body = await c.req.json();
  const allowed = ['label', 'image_url', 'image_pos', 'featured', 'position', 'active'];
  const update = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  );
  const { data, error } = await db
    .from('categories')
    .update(update)
    .eq('id', c.req.param('id'))
    .eq('tenant_id', c.get('tenantId'))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'No encontrado' }, 404);
  return c.json(data);
});

// DELETE /api/admin/categories/:id
admin.delete('/categories/:id', async (c) => {
  const db = c.get('userClient');
  const { error } = await db
    .from('categories')
    .delete()
    .eq('id', c.req.param('id'))
    .eq('tenant_id', c.get('tenantId'));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ─────────── Ítems ───────────────────────────────────────────────

// GET /api/admin/items?category_id=xxx
admin.get('/items', async (c) => {
  const db = c.get('userClient');
  const catId = c.req.query('category_id');
  let q = db
    .from('items')
    .select('id, category_id, name, description, price, image_url, tags, position, active')
    .eq('tenant_id', c.get('tenantId'))
    .order('position');
  if (catId) q = q.eq('category_id', catId);
  const { data, error } = await q;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// POST /api/admin/items
admin.post('/items', async (c) => {
  const db  = c.get('userClient');
  const tid = c.get('tenantId');
  const body = await c.req.json();

  // Plan check: en Free hay tope de FREE_LIMITS.items
  const { data: tenant } = await db
    .from('tenants')
    .select('plan, plan_status, trial_ends_at, plan_expires_at')
    .eq('id', tid)
    .single();
  const eff = effectivePlan(tenant);
  if (eff.plan === 'free') {
    const { count } = await db
      .from('items')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tid);
    if ((count || 0) >= FREE_LIMITS.items) {
      return c.json({
        error: 'plan_limit_reached',
        message: `El plan Free permite hasta ${FREE_LIMITS.items} platos. Pasate a Pro para agregar más.`,
        limit: FREE_LIMITS.items,
        used: count,
      }, 402);
    }
  }

  const { data, error } = await db
    .from('items')
    .insert({ ...body, tenant_id: tid })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

// PATCH /api/admin/items/:id
admin.patch('/items/:id', async (c) => {
  const db = c.get('userClient');
  const body = await c.req.json();
  const allowed = ['name', 'description', 'price', 'image_url', 'tags', 'position', 'active', 'category_id'];
  const update = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  );
  const { data, error } = await db
    .from('items')
    .update(update)
    .eq('id', c.req.param('id'))
    .eq('tenant_id', c.get('tenantId'))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'No encontrado' }, 404);
  return c.json(data);
});

// DELETE /api/admin/items/:id
admin.delete('/items/:id', async (c) => {
  const db = c.get('userClient');
  const { error } = await db
    .from('items')
    .delete()
    .eq('id', c.req.param('id'))
    .eq('tenant_id', c.get('tenantId'));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ─────────── Reordenar ───────────────────────────────────────────

// PATCH /api/admin/categories/reorder
// Body: [{ id, position }, ...]
admin.patch('/categories/reorder', async (c) => {
  const db = c.get('userClient');
  const items = await c.req.json();
  const tid = c.get('tenantId');
  const updates = items.map(({ id, position }) =>
    db.from('categories').update({ position }).eq('id', id).eq('tenant_id', tid)
  );
  await Promise.all(updates);
  return c.body(null, 204);
});

// PATCH /api/admin/items/reorder
// Body: [{ id, position }, ...]
admin.patch('/items/reorder', async (c) => {
  const db = c.get('userClient');
  const items = await c.req.json();
  const tid = c.get('tenantId');
  const updates = items.map(({ id, position }) =>
    db.from('items').update({ position }).eq('id', id).eq('tenant_id', tid)
  );
  await Promise.all(updates);
  return c.body(null, 204);
});

// ─────────── Promociones ─────────────────────────────────────────

// GET /api/admin/promotions
admin.get('/promotions', async (c) => {
  const db = c.get('userClient');
  const { data, error } = await db
    .from('promotions')
    .select('id, tag, title, subtitle, time_label, style, details, position, active, starts_at, ends_at')
    .eq('tenant_id', c.get('tenantId'))
    .order('position');
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// POST /api/admin/promotions
admin.post('/promotions', async (c) => {
  const db = c.get('userClient');
  const body = await c.req.json();
  const { data, error } = await db
    .from('promotions')
    .insert({ ...body, tenant_id: c.get('tenantId') })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

// PATCH /api/admin/promotions/:id
admin.patch('/promotions/:id', async (c) => {
  const db = c.get('userClient');
  const body = await c.req.json();
  const allowed = ['tag', 'title', 'subtitle', 'time_label', 'style', 'details', 'position', 'active', 'starts_at', 'ends_at'];
  const update = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  );
  const { data, error } = await db
    .from('promotions')
    .update(update)
    .eq('id', c.req.param('id'))
    .eq('tenant_id', c.get('tenantId'))
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 500);
  if (!data) return c.json({ error: 'No encontrado' }, 404);
  return c.json(data);
});

// DELETE /api/admin/promotions/:id
admin.delete('/promotions/:id', async (c) => {
  const db = c.get('userClient');
  const { error } = await db
    .from('promotions')
    .delete()
    .eq('id', c.req.param('id'))
    .eq('tenant_id', c.get('tenantId'));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

// ─────────── Mesas ───────────────────────────────────────────────

// GET /api/admin/tables
admin.get('/tables', async (c) => {
  const db = c.get('userClient');
  const { data, error } = await db
    .from('tables')
    .select('id, number, qr_token')
    .eq('tenant_id', c.get('tenantId'))
    .order('number');
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

// POST /api/admin/tables  — agregar una o varias mesas
// Body: { count: 5 }  o  { number: 13 }
admin.post('/tables', async (c) => {
  const db = c.get('userClient');
  const tid = c.get('tenantId');
  const body = await c.req.json();

  let rows;
  if (body.count) {
    // Obtener el número más alto actual
    const { data: existing } = await db
      .from('tables').select('number').eq('tenant_id', tid).order('number', { ascending: false }).limit(1);
    const start = (existing?.[0]?.number ?? 0) + 1;
    rows = Array.from({ length: body.count }, (_, i) => ({ tenant_id: tid, number: start + i }));
  } else {
    rows = [{ tenant_id: tid, number: body.number }];
  }

  const { data, error } = await db.from('tables').insert(rows).select();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data, 201);
});

// DELETE /api/admin/tables/:id
admin.delete('/tables/:id', async (c) => {
  const db = c.get('userClient');
  const { error } = await db
    .from('tables')
    .delete()
    .eq('id', c.req.param('id'))
    .eq('tenant_id', c.get('tenantId'));
  if (error) return c.json({ error: error.message }, 500);
  return c.body(null, 204);
});

export { admin };
