import { Hono } from 'hono';
import { requireAuth, getServiceClient } from '../middleware/auth.js';

const admin = new Hono();

// Todos los endpoints admin requieren JWT válido
admin.use('*', requireAuth);

// ─────────── Auth / Onboarding ───────────────────────────────────

// POST /api/admin/onboard
// Body: { email, password, slug, name }
// Crea el usuario en Supabase Auth + tenant + mesas por defecto.
// Usar SOLO en el registro inicial; después el signup lo maneja el cliente.
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
    .select('id, slug, name, logo_url, primary_color, plan, active')
    .eq('id', c.get('tenantId'))
    .single();
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
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
  const db = c.get('userClient');
  const body = await c.req.json();
  const { data, error } = await db
    .from('items')
    .insert({ ...body, tenant_id: c.get('tenantId') })
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
