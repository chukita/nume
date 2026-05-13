// Webhooks de Mercado Pago.
// Doc: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
//
// Eventos relevantes para suscripciones:
//   - subscription_preapproval        → cambios de estado de la suscripción (pending/authorized/cancelled/paused)
//   - subscription_authorized_payment → un cobro mensual fue procesado (approved/rejected)
//   - payment                          → payments puntuales (lo ignoramos, solo nos importan los anteriores)

import { Hono } from 'hono';
import { getServiceClient } from '../middleware/auth.js';
import * as mp from '../lib/mercadopago.js';

const webhooks = new Hono();

// POST /api/webhooks/mercadopago
webhooks.post('/mercadopago', async (c) => {
  let body;
  try { body = await c.req.json(); } catch { body = null; }

  // MP también manda el ID por query (?id=123&topic=...) en su formato legacy
  const id    = body?.data?.id  || c.req.query('id')    || c.req.query('data.id');
  const type  = body?.type      || c.req.query('topic') || c.req.query('type');

  console.log('[mp webhook]', { type, id, body });

  if (!id || !type) {
    return c.json({ ok: true, ignored: 'missing id/type' });
  }

  const svc = getServiceClient();

  try {
    if (type === 'subscription_preapproval' || type === 'preapproval') {
      // Cambio de estado de la suscripción
      const sub = await mp.getSubscription(id);
      await handleSubscriptionUpdate(svc, sub);

    } else if (type === 'subscription_authorized_payment' || type === 'authorized_payment') {
      // Cobro mensual procesado — refrescamos la suscripción asociada
      // (la respuesta de authorized_payment contiene preapproval_id en algunos casos,
      // pero la fuente de verdad es preapproval.next_payment_date)
      if (body?.data?.id) {
        // Si trae el preapproval_id directo en payload:
        const preapprovalId = body.data.preapproval_id || body.preapproval_id;
        if (preapprovalId) {
          const sub = await mp.getSubscription(preapprovalId);
          await handleSubscriptionUpdate(svc, sub);
        }
      }
    }
    // Otros tipos los ignoramos silenciosamente — MP los reintenta si devolvemos error.
  } catch (e) {
    console.error('[mp webhook] error procesando:', e.body || e.message);
    // Devolvemos 200 igual para que MP no entre en loop de reintentos por errores nuestros.
  }

  return c.json({ ok: true });
});

// Mapea el estado MP → nuestros plan_status + actualiza fechas.
async function handleSubscriptionUpdate(svc, sub) {
  // sub.external_reference = tenant_id (lo seteamos al crear)
  const tenantId = sub.external_reference;
  if (!tenantId) {
    console.warn('[mp webhook] preapproval sin external_reference:', sub.id);
    return;
  }

  // Map de estados MP → nuestros
  //   pending     → 'trialing' (no se usa, la suscripción arranca pending y pasa a authorized)
  //   authorized  → 'active'
  //   paused      → 'past_due'
  //   cancelled   → 'canceled'
  let plan_status;
  switch (sub.status) {
    case 'authorized': plan_status = 'active';   break;
    case 'paused':     plan_status = 'past_due'; break;
    case 'cancelled':  plan_status = 'canceled'; break;
    default:           plan_status = null; // pending u otros: no tocamos
  }

  const update = {
    billing_provider: 'mercadopago',
    billing_subscription_id: sub.id,
  };

  if (plan_status) {
    update.plan_status = plan_status;
    if (plan_status === 'active') {
      // sub.next_payment_date marca cuándo se cobra el próximo mes; ese es nuestro plan_expires_at
      // Si no viene, fallback a now + 31 días para tener margen.
      update.plan_expires_at = sub.next_payment_date
        ? new Date(sub.next_payment_date).toISOString()
        : new Date(Date.now() + 31 * 86400000).toISOString();
      update.plan = 'pro';
    }
  }

  const { error } = await svc.from('tenants').update(update).eq('id', tenantId);
  if (error) console.error('[mp webhook] error actualizando tenant:', error);
  else       console.log('[mp webhook] tenant actualizado', tenantId, update);
}

export { webhooks };
