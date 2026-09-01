import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { auth } from '@/auth';
import { getStripe, isStripeConfigured, STRIPE_PRICE_IDS, type StripeTier } from '@/app/lib/stripe';
import { trustedOrigin } from '@/app/lib/security';

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const tier = body.tier as StripeTier;
  const eventDate = typeof body.event_date === 'string' ? body.event_date : null;
  // slug identifiziert die Feier, die freigeschaltet werden soll (beide
  // Kaufwege, Paar und DJ). unlock_gift markiert den DJ-Kaufweg: der Käufer
  // bekommt dafür ein Event-Guthaben geschenkt.
  const slug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : null;
  const unlockGiftRequested = body.unlock_gift === true;
  if (!tier || !(tier in STRIPE_PRICE_IDS)) {
    return NextResponse.json({ error: 'invalid tier' }, { status: 400 });
  }
  // Server-side validation of the client-supplied event date for the pay-per-use
  // pass: must be a real date and not absurdly far in the future. Never trust the client.
  // Zwei Jahre Vorlauf, weil Hochzeiten 12 bis 18 Monate im Voraus geplant werden.
  if (eventDate && (tier === 'event_pass' || tier === 'couple_pass')) {
    const parsed = new Date(eventDate);
    const maxAhead = new Date();
    maxAhead.setFullYear(maxAhead.getFullYear() + 2);
    if (Number.isNaN(parsed.getTime()) || parsed > maxAhead) {
      return NextResponse.json({ error: 'invalid event_date' }, { status: 400 });
    }
  }
  const priceId = STRIPE_PRICE_IDS[tier];
  if (!priceId) {
    return NextResponse.json({ error: 'price not configured for tier' }, { status: 503 });
  }

  await initDB();

  const stripe = getStripe();
  const userId = session.user.id;

  // Sicherheitsrelevant: der slug kommt vom Client. Ohne Existenzprüfung
  // würde ein erfundener slug bis in den Stripe-Webhook durchgereicht und
  // dort als "unlock"-Metadatum akzeptiert. Nur echte Feiern sind kaufbar.
  let eventId: number | null = null;
  let eventIsOwned = false;
  if (slug) {
    const { rows: slugRows } = await sql`
      SELECT id, dj_id FROM events WHERE slug = ${slug}
    `;
    if (slugRows.length === 0) {
      return NextResponse.json({ error: 'event not found' }, { status: 400 });
    }
    eventId = slugRows[0].id;
    eventIsOwned = slugRows[0].dj_id === userId;
  }

  // Sicherheitsrelevant: unlock_gift kommt aus dem Request-Body und ist damit
  // vom Client frei wählbar. Das Guthaben ist exklusiv dem DJ-Kaufweg
  // vorbehalten (DJ ohne Konto registriert sich im Zuge des Kaufs). Ohne
  // diese Prüfung könnte jedes eingeloggte Paar bei seinem eigenen Kauf
  // zusätzlich unlock_gift:true setzen und sich selbst ein Guthaben schenken.
  // Ein Guthaben gibt es daher nur, wenn die Feier existiert und der Käufer
  // nicht ihr eigener Besitzer ist.
  let unlockGift = false;
  if (unlockGiftRequested && slug && eventId !== null && !eventIsOwned) {
    unlockGift = true;
  }

  // Lazy-create stripe customer
  const { rows } = await sql`
    SELECT stripe_customer_id, name FROM users WHERE id = ${userId}
  `;
  let customerId = rows[0]?.stripe_customer_id as string | null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email,
      name: rows[0]?.name ?? session.user.name ?? undefined,
      metadata: { user_id: userId },
    });
    customerId = customer.id;
    await sql`
      UPDATE users SET stripe_customer_id = ${customerId} WHERE id = ${userId}
    `;
  }

  // Der Origin-Header ist bei direkten HTTP-Calls frei wählbar. Ohne Allowlist
  // könnte ein Angreifer eine Checkout-Session mit Rückweg auf seine eigene
  // Domain erzeugen und die Stripe-URL als Phishing-Link verteilen.
  const origin = trustedOrigin(req.headers.get('origin'), req.url);

  const isCouplePass = tier === 'couple_pass';

  const isSubscription =
    tier === 'pro_monthly' ||
    tier === 'pro_yearly' ||
    tier === 'studio_monthly' ||
    tier === 'studio_yearly';

  const checkout = await stripe.checkout.sessions.create({
    mode: isSubscription ? 'subscription' : 'payment',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    customer_update: { address: 'auto', name: 'auto' },
    billing_address_collection: 'required',
    allow_promotion_codes: true,
    // Bei 0-€-Checkouts (100%-Promo-Code, z.B. Pilot-Testzugänge) keine
    // Kartendaten verlangen. Nach Ablauf des Coupons scheitert die nächste
    // Abrechnung mangels Zahlungsmethode und das Abo läuft aus, statt den
    // Tester unerwartet zu belasten. Bei bezahlten Checkouts verlangt Stripe
    // weiterhin normal die Zahlungsmethode.
    payment_method_collection: 'if_required',
    // Der Brautpaar-Pass wird auf /feier gekauft, also führt der Rückweg auch
    // dorthin zurück und nicht in die DJ-Ansicht.
    success_url: `${origin}${isCouplePass ? '/feier?checkout=success' : '/dj?checkout=success'}`,
    cancel_url: `${origin}${isCouplePass ? '/feier' : '/dj'}`,
    client_reference_id: userId,
    metadata: {
      user_id: userId,
      tier,
      event_date: eventDate ?? '',
      ...(slug && eventId !== null ? { slug, event_id: String(eventId) } : {}),
      ...(unlockGift ? { gift_credit: '1' } : {}),
    },
    ...(isSubscription
      ? { subscription_data: { metadata: { user_id: userId, tier } } }
      : {
          payment_intent_data: {
            metadata: {
              user_id: userId,
              tier,
              event_date: eventDate ?? '',
              ...(slug && eventId !== null ? { slug, event_id: String(eventId) } : {}),
              ...(unlockGift ? { gift_credit: '1' } : {}),
            },
          },
        }),
  });

  return NextResponse.json({ url: checkout.url });
}
