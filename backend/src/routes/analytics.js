import { Hono } from 'hono';
import { supabase } from '../db.js';
import { requireAuth, requireTenant } from '../middleware/auth.js';

const analytics = new Hono();

// ─────────── Tracking público ────────────────────────────────────

// POST /api/events
// Body: { slug, events: [{ type, payload }] }
// Sin auth — el frontend lo llama sin JWT.
// Se valida el slug para obtener el tenant_id.
analytics.post('/events', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.slug || !Array.isArray(body.events) || body.events.length === 0) {
    return c.json({ error: 'Formato inválido' }, 400);
  }

  // Resolver tenant por slug
  const { data: tenant, error: tenantErr } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', body.slug)
    .eq('active', true)
    .single();

  if (tenantErr || !tenant) return c.json({ error: 'Tenant no encontrado' }, 404);

  const VALID_TYPES = ['menu_view', 'item_view', 'favorite', 'search', 'promo_click'];
  const MAX_BATCH = 50;

  const rows = body.events
    .slice(0, MAX_BATCH)
    .filter(e => VALID_TYPES.includes(e.type))
    .map(e => ({
      tenant_id: tenant.id,
      type: e.type,
      payload: e.payload ?? {},
    }));

  if (rows.length === 0) return c.json({ ok: true, inserted: 0 });

  const { error } = await supabase.from('events').insert(rows);
  if (error) {
    console.error('events insert error:', error);
    return c.json({ error: 'Error al guardar eventos' }, 500);
  }

  return c.json({ ok: true, inserted: rows.length });
});

// ─────────── Analytics admin (requiere auth) ─────────────────────

analytics.use('/admin/*', requireAuth);
analytics.use('/admin/*', requireTenant);

// GET /api/analytics/admin/summary?period=7
// Devuelve: totales por tipo, trend diario, top items, top búsquedas
analytics.get('/admin/summary', async (c) => {
  const db = c.get('userClient');
  const tid = c.get('tenantId');
  const days = Math.min(parseInt(c.req.query('period') || '7'), 30);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const [totalsRes, dailyRes, topItemsRes, topSearchRes, topPromosRes] = await Promise.all([
    // Totales por tipo
    db.from('events')
      .select('type')
      .eq('tenant_id', tid)
      .gte('created_at', since),

    // Tendencia diaria de menu_view
    db.rpc('analytics_daily_views', { p_tenant_id: tid, p_since: since }).maybeSingle()
      .then(() => // fallback: calcular en JS
        db.from('events')
          .select('created_at')
          .eq('tenant_id', tid)
          .eq('type', 'menu_view')
          .gte('created_at', since)
      ),

    // Top 10 platos más vistos
    db.from('events')
      .select('payload')
      .eq('tenant_id', tid)
      .eq('type', 'item_view')
      .gte('created_at', since),

    // Top 10 búsquedas
    db.from('events')
      .select('payload')
      .eq('tenant_id', tid)
      .eq('type', 'search')
      .gte('created_at', since),

    // Top promos clickeadas
    db.from('events')
      .select('payload')
      .eq('tenant_id', tid)
      .eq('type', 'promo_click')
      .gte('created_at', since),
  ]);

  // Totales
  const counts = {};
  for (const e of totalsRes.data || []) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }

  // Trend diario: agrupar en JS
  const dailyMap = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    dailyMap[key] = 0;
  }
  for (const e of dailyRes.data || []) {
    const key = e.created_at.slice(0, 10);
    if (dailyMap[key] !== undefined) dailyMap[key]++;
  }
  const trend = Object.entries(dailyMap).map(([date, total]) => ({ date, total }));

  // Top items
  const itemCounts = {};
  for (const e of topItemsRes.data || []) {
    const id = e.payload?.item_id;
    const name = e.payload?.item_name || 'Desconocido';
    if (!id) continue;
    if (!itemCounts[id]) itemCounts[id] = { id, name, views: 0 };
    itemCounts[id].views++;
  }
  const topItems = Object.values(itemCounts)
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  // Top búsquedas
  const searchCounts = {};
  for (const e of topSearchRes.data || []) {
    const q = (e.payload?.query || '').toLowerCase().trim();
    if (q.length < 2) continue;
    searchCounts[q] = (searchCounts[q] || 0) + 1;
  }
  const topSearches = Object.entries(searchCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, total]) => ({ query, total }));

  // Top promos
  const promoCounts = {};
  for (const e of topPromosRes.data || []) {
    const id = e.payload?.promo_id;
    const title = e.payload?.promo_title || 'Promo';
    if (!id) continue;
    if (!promoCounts[id]) promoCounts[id] = { id, title, clicks: 0 };
    promoCounts[id].clicks++;
  }
  const topPromos = Object.values(promoCounts)
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 5);

  return c.json({
    period: days,
    counts: {
      menu_views:   counts.menu_view    || 0,
      item_views:   counts.item_view    || 0,
      favorites:    counts.favorite     || 0,
      searches:     counts.search       || 0,
      promo_clicks: counts.promo_click  || 0,
    },
    trend,
    top_items:   topItems,
    top_searches: topSearches,
    top_promos:  topPromos,
  });
});

export { analytics };
