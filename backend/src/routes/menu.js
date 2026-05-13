import { Hono } from 'hono';
import { supabase } from '../db.js';

const menu = new Hono();

// GET /api/:slug/menu
// Devuelve el menú completo del tenant: tenant info, categorías con sus platos, promos vigentes.
// Endpoint público — sin auth. Cacheado 60s en el cliente.
menu.get('/:slug/menu', async (c) => {
  const { slug } = c.req.param();

  // 1. Resolver tenant por slug
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, logo_url, primary_color')
    .eq('slug', slug)
    .eq('active', true)
    .single();

  if (tenantErr || !tenant) {
    return c.json({ error: 'Local no encontrado' }, 404);
  }

  // 2. Categorías + platos activos en paralelo con promos
  const [catsResult, promsResult] = await Promise.all([
    supabase
      .from('categories')
      .select(`
        id, label, image_url, image_pos, featured, position,
        items (
          id, name, description, price, image_url, tags, position
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

  c.header('Cache-Control', 'public, max-age=60');

  return c.json({
    tenant: {
      name: tenant.name,
      logo_url: tenant.logo_url,
      primary_color: tenant.primary_color,
    },
    categories: catsResult.data,
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
