# Programa de afiliados / vendedores — análisis previo

> Notas para cuando llegue el momento de implementar un sistema de afiliados
> que cobren comisión por referir nuevas suscripciones a NuMe.
>
> Estado: **pendiente.** No implementar todavía. Prioridad: validar que los
> clientes pagan antes de invertir en canales de adquisición.

---

## Herramientas externas (todas Stripe-first)

| Herramienta | Precio | Notas |
|---|---|---|
| **Rewardful** | desde US$49/mes | Más popular en SaaS. Setup en ~1 h si usás Stripe |
| **Tolt** | desde US$29/mes | Más simple y moderno |
| **FirstPromoter** | desde US$49/mes | Clásico |
| **PartnerStack** | desde US$300/mes | Enterprise, overkill para esta etapa |
| **Reditus** | desde US$49/mes | Bueno para startups |

**Problema:** ninguna integra nativo con Mercado Pago. Se pueden enganchar
con webhooks custom, pero pierde la gracia de ser plug-and-play.

---

## Recomendación: build in-house

Para el caso de NuMe (AR + Mercado Pago + escala chica para arrancar),
implementar el sistema dentro del producto sale más a cuenta que pelearse
con una integración custom contra una herramienta Stripe.

### Schema (1 migración SQL)

```
affiliates    — quién es, código de referido, datos de cobro
referrals     — qué tenant vino de qué afiliado (atribución)
commissions   — comisiones calculadas por período
```

### Fases sugeridas

| Fase | Qué incluye | Esfuerzo |
|---|---|---|
| **1. Tracking** | URL con `?ref=CODE` en landing → cookie → atribuir en signup | 1 día |
| **2. Dashboard del afiliado** | Pantalla nueva (login propio o como rol). Stats: clicks, signups, conversiones, ganancias del mes | 1.5 días |
| **3. Cálculo de comisión** | Job nocturno: por cada pago confirmado por MP, calcula X% para el afiliado del tenant | 0.5 días |
| **4. Pago** | Export CSV con email + monto + alias MP → transferencia manual vía Mercado Pago. Más adelante automatizable con MP Money Out API | 1 día |

**Total estimado: 3–5 días de trabajo.**

---

## Decisiones que tomar antes de codear

- **Modelo de comisión**
  - % recurrente del MRR (ej. 20% mientras el cliente sigue activo)
  - Pago único por signup (ej. ARS 5.000 al confirmarse el primer cobro)
- **Atribución**
  - First-touch (gana la primera referencia)
  - Last-touch con cookie de 30–90 días (lo más común)
- **Onboarding del afiliado**
  - Auto-servicio (cualquiera se registra)
  - Aplicación manual (revisión antes de aprobar)
- **Pago mínimo**
  - Acumular hasta cierto umbral antes de transferir (ej. ARS 5.000) para
    no hacer muchas transferencias chicas

---

## Automatización del pago de comisiones

Casi todo es automatizable usando la **MP Money Out API** (transferencias
programáticas a CVU/alias). Lo único irreducible es que el afiliado
genere su factura en AFIP — eso lo tiene que hacer él.

### Workflow end-to-end automático

```
Día 1 del mes
  ↓
Sistema calcula comisiones pendientes
  ↓
Email al afiliado: "Tu comisión de mayo es $8.000.
                    Subí tu factura acá: [link]
                    Te transferimos en 24h una vez recibida."
  ↓
Afiliado sube factura PDF en portal NuMe (1 min)
  ↓
Sistema marca "pendiente revisión"
  ↓
Revisión manual con 1 click (o automatizar si confiás)
  ↓
Sistema dispara MP Money Out → transfiere
  ↓
Email confirmación + actualiza dashboard
```

**Tiempo humano por mes:** 5–10 min revisando facturas + clic aprobar.
Todo lo demás corre solo.

### Qué se automatiza completo

| Paso | Cómo |
|---|---|
| Tracking de referidos | Cookies + atribución al signup |
| Cálculo de comisiones | Job nocturno cruza pagos confirmados × afiliado |
| Listado mensual de pagos | Query a la DB, total por afiliado |
| Transferir el dinero | MP Money Out API (CVU/alias) |
| Email "te transferimos $X" | SMTP / Resend |
| Reflejar el pago en dashboard del afiliado | Update DB |

### Qué queda manual (irreducible)

- Generación de la factura por el afiliado (en AFIP, lo hace él)
- Verificación visual de la factura (~30 seg por afiliado)

### Limitaciones de MP Money Out

- Requiere cuenta MP **empresa** verificada (gratis)
- Límites diarios de transferencia (~ARS 500k al inicio, suben con
  historial)
- Cada transferencia es una operación más en la cuenta MP — sin fee
  extra si va por CVU/alias

### Esfuerzo extra de construcción (sobre las fases 1–4)

| Pieza | Días |
|---|---|
| Integración MP Money Out + manejo de errores | 2 |
| Portal de upload de facturas + cola de revisión | 1.5 |
| Emails transaccionales | 0.5 |
| **Total adicional** | **~4 días** |

Total final del módulo de afiliados con automatización completa:
**~7 días de trabajo** vs los 3–5 días del MVP manual (export CSV).

---

## Cuándo migrar a una herramienta externa

Si en el futuro NuMe acepta **Stripe** (para vender fuera de Argentina),
ahí Rewardful u otra similar sí tiene sentido:

- Dejar el sistema in-house para clientes que pagan con Mercado Pago
- Usar Rewardful para clientes que pagan con Stripe
- O migrar todo a Rewardful + webhook custom de MP

Mientras el cobro siga siendo solo con Mercado Pago, el sistema propio es
más simple y más barato.
