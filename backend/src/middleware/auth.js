import { createClient } from '@supabase/supabase-js';

// Cliente con service_role para operaciones privadas (onboarding, etc.)
export function getServiceClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY en el .env');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// Middleware Hono: verifica el JWT de Supabase y adjunta el usuario al contexto.
// NO exige que el usuario tenga tenant — para eso usar `requireTenant` además.
export async function requireAuth(c, next) {
  const auth = c.req.header('Authorization');
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'No autenticado' }, 401);
  }

  const token = auth.slice(7);

  // Crear cliente con el JWT del usuario — Supabase aplica RLS automáticamente
  const userClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) {
    return c.json({ error: 'Token inválido o expirado' }, 401);
  }

  // tenant_id viene como claim top-level del JWT (vía custom_access_token_hook)
  // y como fallback se mira en app_metadata por compatibilidad.
  let tenantId = null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    tenantId = payload.tenant_id || null;
  } catch {}
  if (!tenantId) tenantId = user.app_metadata?.tenant_id || null;

  c.set('user', user);
  c.set('tenantId', tenantId); // puede ser null si todavía no se hizo onboarding
  c.set('userClient', userClient);
  await next();
}

// Para endpoints que requieren que el usuario YA tenga tenant.
// Usar después de requireAuth.
export async function requireTenant(c, next) {
  if (!c.get('tenantId')) {
    return c.json({ error: 'Usuario sin tenant asignado' }, 403);
  }
  await next();
}
