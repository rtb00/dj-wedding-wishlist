import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { getFingerprint } from '@/app/lib/fingerprint';
import { readOrCreateGuestId, attachGuestCookie } from '@/app/lib/guest-id';
import { isRateLimited } from '@/app/lib/rate-limit';
import { clientIpHash } from '@/app/lib/security';

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await initDB();

  const { id: guestId, isNew: guestIdIsNew } = readOrCreateGuestId(req);
  const fp = getFingerprint(guestId, params.slug);

  if (isRateLimited(`unvote:${clientIpHash(req)}`, 30, 60_000)) {
    const res = NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    return attachGuestCookie(res, guestId, guestIdIsNew);
  }

  let body: { songId?: unknown };
  try {
    body = await req.json();
  } catch {
    const res = NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
    return attachGuestCookie(res, guestId, guestIdIsNew);
  }

  const songId = Number(body.songId);
  if (!Number.isInteger(songId) || songId <= 0) {
    const res = NextResponse.json({ error: 'songId required' }, { status: 400 });
    return attachGuestCookie(res, guestId, guestIdIsNew);
  }

  await sql`
    DELETE FROM votes
    WHERE song_id = ${songId}
      AND voter_ip = ${fp}
      AND song_id IN (
        SELECT s.id FROM songs s
        JOIN events e ON e.id = s.event_id
        WHERE e.slug = ${params.slug}
      )
  `;

  const res = NextResponse.json({ ok: true });
  return attachGuestCookie(res, guestId, guestIdIsNew);
}
