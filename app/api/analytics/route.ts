import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { isRateLimited } from '@/app/lib/rate-limit';
import { clientIp } from '@/app/lib/security';

const EVENT_TYPE_RE = /^[A-Za-z0-9_.-]{1,40}$/;

function str(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!s || s.length > max) return null;
  return s;
}

export async function POST(req: NextRequest) {
  // Unauthentifizierter Schreib-Endpoint: ohne Validierung und Deckel wäre er
  // ein DB-Flutungs-Vektor (beliebige Strings, beliebige Länge, unbegrenzt oft).
  if (isRateLimited(`analytics:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  await initDB();
  const body = await req.json().catch(() => ({}));
  const { event_type, pricing_variant, tier_clicked, fingerprint } = body as Record<string, unknown>;

  if (typeof event_type !== 'string' || !EVENT_TYPE_RE.test(event_type)) {
    return NextResponse.json({ error: 'event_type required' }, { status: 400 });
  }

  await sql`
    INSERT INTO analytics (event_type, pricing_variant, tier_clicked, fingerprint)
    VALUES (
      ${event_type},
      ${str(pricing_variant, 40)},
      ${str(tier_clicked, 40)},
      ${str(fingerprint, 128)}
    )
  `;

  return NextResponse.json({ ok: true });
}
