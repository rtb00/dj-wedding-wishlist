import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { auth } from '@/auth';
import { getStripe, isStripeConfigured } from '@/app/lib/stripe';
import { trustedOrigin } from '@/app/lib/security';

export async function POST(req: NextRequest) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 503 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await initDB();

  const { rows } = await sql`
    SELECT stripe_customer_id FROM users WHERE id = ${session.user.id}
  `;
  const customerId = rows[0]?.stripe_customer_id as string | null;
  if (!customerId) {
    return NextResponse.json({ error: 'no stripe customer' }, { status: 400 });
  }

  // Origin-Allowlist wie im Checkout: der Header ist client-frei wählbar.
  const origin = trustedOrigin(req.headers.get('origin'), req.url);

  const portal = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dj`,
  });

  return NextResponse.json({ url: portal.url });
}
