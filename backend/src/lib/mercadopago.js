// Mercado Pago — wrapper mínimo sobre la REST API.
// Documentación: https://www.mercadopago.com.ar/developers/es/reference
//
// Usamos "preapproval" (Suscripciones) para cobros recurrentes mensuales.
// Cada tenant tiene una preapproval_id activa una vez que se suscribe.

const MP_API   = 'https://api.mercadopago.com';
const PRO_PRICE_ARS = Number(process.env.MERCADOPAGO_PRO_PRICE_ARS || 15000);
const ACCESS_TOKEN  = process.env.MERCADOPAGO_ACCESS_TOKEN || '';

function isConfigured() {
  return ACCESS_TOKEN.length > 0;
}

async function mpFetch(path, opts = {}) {
  if (!isConfigured()) {
    throw new Error('Mercado Pago no está configurado (falta MERCADOPAGO_ACCESS_TOKEN)');
  }
  const res = await fetch(`${MP_API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(json?.message || `Mercado Pago error ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

// Crear una suscripción (preapproval). Devuelve { id, init_point, status }.
//   payerEmail   — email del payer (debe coincidir con la cuenta MP del cliente)
//   tenantId     — UUID del tenant; se usa en external_reference para el webhook
//   backUrl      — URL a la que vuelve el usuario tras autorizar/cancelar
export async function createSubscription({ payerEmail, tenantId, backUrl }) {
  return mpFetch('/preapproval', {
    method: 'POST',
    body: JSON.stringify({
      reason: 'NuMe Pro — suscripción mensual',
      external_reference: tenantId,
      payer_email: payerEmail,
      back_url: backUrl,
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: PRO_PRICE_ARS,
        currency_id: 'ARS',
      },
      status: 'pending', // queda pending hasta que el payer autoriza en MP
    }),
  });
}

// Cancelar (pausar definitivamente) una suscripción existente.
export async function cancelSubscription(preapprovalId) {
  return mpFetch(`/preapproval/${preapprovalId}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'cancelled' }),
  });
}

// Consultar el estado de una suscripción.
export async function getSubscription(preapprovalId) {
  return mpFetch(`/preapproval/${preapprovalId}`);
}

// Consultar un pago puntual (los webhooks de tipo "payment" mandan el ID acá).
export async function getPayment(paymentId) {
  return mpFetch(`/v1/payments/${paymentId}`);
}

export const config = {
  proPriceArs: PRO_PRICE_ARS,
  isConfigured: isConfigured(),
};
