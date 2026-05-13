// Lógica central de planes. La fuente de verdad para decidir si un
// tenant tiene Pro o Free efectivo en cualquier momento.
//
// El campo `plan` en la DB indica la intención del usuario; pero el
// "plan efectivo" depende también del status y las fechas.
//   - pro + trialing  + ahora < trial_ends_at        → pro (trial)
//   - pro + active    + ahora < plan_expires_at      → pro
//   - cualquier otra cosa                            → free

export const FREE_LIMITS = {
  items: 4, // platos máximos en plan free
};

export function effectivePlan(tenant) {
  if (!tenant) return { plan: 'free', isTrial: false, expiresAt: null };

  const now = Date.now();
  const trialEnd  = tenant.trial_ends_at  ? new Date(tenant.trial_ends_at).getTime()  : 0;
  const planEnd   = tenant.plan_expires_at ? new Date(tenant.plan_expires_at).getTime() : 0;

  if (tenant.plan === 'pro') {
    if (tenant.plan_status === 'trialing' && trialEnd > now) {
      return { plan: 'pro', isTrial: true,  expiresAt: tenant.trial_ends_at };
    }
    if (tenant.plan_status === 'active'   && planEnd  > now) {
      return { plan: 'pro', isTrial: false, expiresAt: tenant.plan_expires_at };
    }
    // past_due: por ahora corta al toque. La gracia se agrega en Fase 3.
  }
  return { plan: 'free', isTrial: false, expiresAt: null };
}

export function isPro(tenant) {
  return effectivePlan(tenant).plan === 'pro';
}
