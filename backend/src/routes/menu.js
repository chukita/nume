import { Hono } from 'hono';
import { supabase } from '../db.js';
import { effectivePlan, FREE_LIMITS } from '../lib/plan.js';

const menu = new Hono();

// GET /api/:slug/menu
// Devuelve el menú completo del tenant: tenant info, categorías con sus platos, promos vigentes.
// Endpoint público — sin auth. Cacheado 60s en el cliente.
menu.get('/:slug/menu', async (c) => {
  const { slug } = c.req.param();

  // 1. Resolver tenant por slug (incluye campos de plan)
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, logo_url, primary_color, plan, plan_status, trial_ends_at, plan_expires_at')
    .eq('slug', slug)
    .eq('active', true)
    .single();

  if (tenantErr || !tenant) {
    return c.json({ error: 'Local no encontrado' }, 404);
  }

  const eff = effectivePlan(tenant);

  // 2. Categorías + platos activos en paralelo con promos
  const [catsResult, promsResult] = await Promise.all([
    supabase
      .from('categories')
      .select(`
        id, label, image_url, image_pos, featured, position,
        items (
          id, name, description, price, image_url, tags, position, created_at
        )
      `)
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .eq('items.active', true)
      .order('position', { ascending: true })
      .order('position', { referencedTable: 'items', ascending: true }),

    supabase
      .from('promotions')
      .select('id, tag, title, subtitle, time_label, style, details, position')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .or('starts_at.is.null,starts_at.lte.now()')
      .or('ends_at.is.null,ends_at.gte.now()')
      .order('position', { ascending: true }),
  ]);

  if (catsResult.error) {
    console.error('Error cargando categorías:', catsResult.error);
    return c.json({ error: 'Error interno' }, 500);
  }
  if (promsResult.error) {
    console.error('Error cargando promos:', promsResult.error);
    return c.json({ error: 'Error interno' }, 500);
  }

  let categories = catsResult.data;

  // En plan Free solo se muestran los N items más recientes (los demás
  // quedan "ocultos" para el cliente pero no se borran de la DB).
  if (eff.plan === 'free') {
    const allItems = categories.flatMap(c =>
      (c.items || []).map(it => ({ ...it, category_id: c.id }))
    );
    allItems.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const visibleIds = new Set(allItems.slice(0, FREE_LIMITS.items).map(it => it.id));
    categories = categories.map(c => ({
      ...c,
      items: (c.items || []).filter(it => visibleIds.has(it.id)),
    }));
  }

  c.header('Cache-Control', 'public, max-age=60');

  return c.json({
    tenant: {
      name: tenant.name,
      // En Free el logo personalizado no se muestra al cliente; el front
      // cae al sello con monograma generado a partir del nombre.
      logo_url: eff.plan === 'pro' ? tenant.logo_url : null,
      primary_color: tenant.primary_color,
      plan: eff.plan, // 'free' | 'pro' — el frontend lo usa para el branding
    },
    categories,
    promotions: promsResult.data,
  });
});

// GET /api/qr/:token  — resuelve un token de QR a { slug, table_number }
menu.get('/qr/:token', async (c) => {
  const { token } = c.req.param();

  const { data, error } = await supabase
    .from('tables')
    .select('number, tenants(slug)')
    .eq('qr_token', token)
    .single();

  if (error || !data) {
    return c.json({ error: 'QR inválido' }, 404);
  }

  return c.json({
    slug: data.tenants.slug,
    table_number: data.number,
  });
});

export { menu };
