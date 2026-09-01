import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { isRateLimited } from '@/app/lib/rate-limit';
import { clientIp } from '@/app/lib/security';

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > max) return null;
  return s;
}

export async function POST(req: NextRequest) {
  // Unauthentifizierter Schreib-Endpoint: Rate-Limit gegen DB-Flutung.
  if (isRateLimited(`waitlist:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  await initDB();
  const body = await req.json().catch(() => ({}));
  const { email, selected_tier, pricing_variant, utm_source } = body as Record<string, unknown>;

  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) {
    return NextResponse.json({ error: 'valid email required' }, { status: 400 });
  }

  await sql`
    INSERT INTO waitlist (email, selected_tier, pricing_variant, utm_source)
    VALUES (
      ${cleanEmail},
      ${str(selected_tier, 40)},
      ${str(pricing_variant, 40)},
      ${str(utm_source, 120)}
    )
  `;

  return NextResponse.json({ ok: true });
}
