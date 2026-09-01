import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { initDB, sql } from '@/app/lib/db';
import { getStripe, isStripeConfigured } from '@/app/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'webhook secret missing' }, { status: 503 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'no signature' }, { status: 400 });

  const raw = await req.text();
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.warn('[stripe-webhook] bad signature', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'bad signature' }, { status: 400 });
  }

  await initDB();

  // Idempotency
  try {
    await sql`
      INSERT INTO stripe_events (id, type) VALUES (${event.id}, ${event.type})
    `;
  } catch {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionChange(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        // ignore all other events
        break;
    }
  } catch (err) {
    console.error('[stripe-webhook]', event.type, err);
    // Remove the idempotency row so a retry can succeed
    await sql`DELETE FROM stripe_events WHERE id = ${event.id}`.catch(() => {});
    return NextResponse.json({ error: 'handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleCheckoutCompleted(stripe: Stripe, sessionObj: Stripe.Checkout.Session) {
  if (sessionObj.mode !== 'payment') return; // subscriptions handled by subscription events
  const userId = sessionObj.metadata?.user_id ?? sessionObj.client_reference_id;
  if (!userId) return;

  // Credit-Pack: schreibt nur Guthaben gut, ändert den Plan nicht.
  if (sessionObj.metadata?.tier === 'credit_pack_5') {
    const packCustomerId =
      typeof sessionObj.customer === 'string' ? sessionObj.customer : sessionObj.customer?.id ?? null;
    await sql`
      UPDATE users
      SET event_credits = event_credits + 5,
          stripe_customer_id = COALESCE(stripe_customer_id, ${packCustomerId})
      WHERE id = ${userId}
    `;
    return;
  }

  const eventDateRaw = sessionObj.metadata?.event_date;
  const periodEnd = computeEventPassPeriodEnd(eventDateRaw);

  const customerId =
    typeof sessionObj.customer === 'string' ? sessionObj.customer : sessionObj.customer?.id ?? null;

  await sql`
    UPDATE users
    SET plan = 'event_pass',
        plan_status = 'active',
        current_period_end = ${periodEnd.toISOString()},
        cancel_at_period_end = FALSE,
        stripe_customer_id = COALESCE(stripe_customer_id, ${customerId})
    WHERE id = ${userId}
  `;

  // Beide Kaufwege (Paar auf /feier, DJ auf dem DJ-Screen) tragen die Feier
  // in den Metadaten und schalten dieselbe Feier frei, unabhängig vom Tarif
  // des Käufers. Idempotent über die stripe_events-Absicherung oben, deshalb
  // hier keine zusätzliche Prüfung nötig.
  const slug = sessionObj.metadata?.slug;
  if (slug) {
    // Die Feier wurde beim Checkout serverseitig gegen die DB validiert und
    // ihre id in den Metadaten mitgeschrieben — hier beide Kriterien gegen
    // prüfen, damit ein manipuliertes slug-Metadatum nichts freischalten kann.
    const eventId = Number(sessionObj.metadata?.event_id ?? NaN);
    if (Number.isInteger(eventId) && eventId > 0) {
      await sql`
        UPDATE events SET unlocked_at = NOW()
        WHERE slug = ${slug} AND id = ${eventId} AND unlocked_at IS NULL
      `;
    } else {
      await sql`
        UPDATE events SET unlocked_at = NOW() WHERE slug = ${slug} AND unlocked_at IS NULL
      `;
    }
  }

  // Der DJ-Kaufweg schenkt dem Käufer ein Event-Guthaben als Kernanreiz für
  // die Registrierung im Zuge des Kaufs.
  if (sessionObj.metadata?.gift_credit === '1') {
    await sql`
      UPDATE users SET event_credits = event_credits + 1 WHERE id = ${userId}
    `;
  }
}

// Maps a Stripe price ID back to our internal tier. Built from env at call time
// so it reflects whatever STRIPE_PRICE_* vars are configured in this environment.
// Fail-closed: unbekannte Price-IDs ergeben null — sonst würde jede versehentlich
// neu angelegte, nicht konfigurierte Preis-ID stillschweigend Pro-Status
// verleihen.
function tierForPrice(priceId: string | null): 'pro' | 'studio' | null {
  if (!priceId) return null;
  const map: Record<string, 'pro' | 'studio'> = {};
  if (process.env.STRIPE_PRICE_PRO_MONTHLY) map[process.env.STRIPE_PRICE_PRO_MONTHLY] = 'pro';
  if (process.env.STRIPE_PRICE_PRO_YEARLY) map[process.env.STRIPE_PRICE_PRO_YEARLY] = 'pro';
  if (process.env.STRIPE_PRICE_STUDIO_MONTHLY) map[process.env.STRIPE_PRICE_STUDIO_MONTHLY] = 'studio';
  if (process.env.STRIPE_PRICE_STUDIO_YEARLY) map[process.env.STRIPE_PRICE_STUDIO_YEARLY] = 'studio';
  return map[priceId] ?? null;
}

async function handleSubscriptionChange(sub: Stripe.Subscription) {
  const userId = sub.metadata?.user_id;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const { rows } = await sql`
      SELECT id FROM users WHERE stripe_customer_id = ${customerId}
    `;
    resolvedUserId = rows[0]?.id;
  }
  if (!resolvedUserId) return;

  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const billingCycle = item?.price?.recurring?.interval ?? null;

  // The Basil/Dahlia API (>= 2025-03-31) moved current_period_end from the
  // Subscription onto its items. Read it from the item, falling back to the
  // legacy subscription-level field for events emitted by older API versions.
  const periodEndUnix =
    item?.current_period_end ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sub as any).current_period_end ??
    null;
  const periodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

  const isActive = sub.status === 'active' || sub.status === 'trialing';
  // Resolve the tier from the purchased price instead of hardcoding 'pro',
  // so pro and studio subscriptions land on the correct plan.
  const tier = tierForPrice(priceId);
  if (!tier) {
    // Unbekannte/nicht konfigurierte Price-ID: nichts ändern statt fail-open.
    console.warn('[stripe-webhook] unknown price id on subscription', { subId: sub.id, priceId });
    return;
  }
  const plan = isActive ? tier : sub.status === 'canceled' ? 'free' : tier;

  await sql`
    UPDATE users
    SET plan = ${plan},
        plan_status = ${sub.status},
        subscription_id = ${sub.id},
        current_price_id = ${priceId},
        billing_cycle = ${billingCycle},
        current_period_end = ${periodEnd},
        cancel_at_period_end = ${sub.cancel_at_period_end ?? false}
    WHERE id = ${resolvedUserId}
  `;
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  await sql`
    UPDATE users
    SET plan = 'free',
        plan_status = 'canceled',
        subscription_id = NULL,
        cancel_at_period_end = FALSE
    WHERE stripe_customer_id = ${customerId}
  `;
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
  if (!customerId) return;
  await sql`
    UPDATE users
    SET plan_status = 'past_due'
    WHERE stripe_customer_id = ${customerId}
  `;
}

function computeEventPassPeriodEnd(eventDateRaw: string | undefined | null): Date {
  // Default fallback: 60 days from now (covers typical pre-wedding window + a few weeks buffer)
  const fallback = new Date();
  fallback.setDate(fallback.getDate() + 60);

  if (!eventDateRaw) return fallback;
  const eventDate = new Date(eventDateRaw);
  if (Number.isNaN(eventDate.getTime())) return fallback;
  // Active until 1 day after the event
  const end = new Date(eventDate);
  end.setDate(end.getDate() + 1);
  end.setHours(23, 59, 59, 999);
  // Never less than 30 days from now (in case user buys ahead of time and then changes nothing)
  const minEnd = new Date();
  minEnd.setDate(minEnd.getDate() + 30);
  return end.getTime() > minEnd.getTime() ? end : minEnd;
}
