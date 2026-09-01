import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { getFingerprint } from '@/app/lib/fingerprint';
import { readOrCreateGuestId, attachGuestCookie } from '@/app/lib/guest-id';
import { isRateLimited } from '@/app/lib/rate-limit';
import { clientIpHash } from '@/app/lib/security';

// Tagesdeckel pro Client-IP und Feier: der Fingerprint rotiert bei jedem
// neuen/leeren Gäste-Cookie (Ballot-Stuffing), die IP nicht. Gehasht statt
// Klartext — ohne Pepper ist die Adresse aus dem Hash nicht wiederherstellbar.
// Der Schwellen ist bewusst großzügig (Feiern mit 100+ Gästen teilen sich oft
// eine Venue-IP) und per Env überschreibbar; der eigentliche Spam-Schutz
// bleibt die 3-Slot-Regel + Gäste-Cookie + Burst-Limit.
const MAX_VOTES_PER_IP_PER_DAY = Number.parseInt(
  process.env.BEATCONTROL_MAX_VOTES_PER_IP_DAY ?? '500',
  10
);

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await initDB();

  const { id: guestId, isNew: guestIdIsNew } = readOrCreateGuestId(req);
  const fp = getFingerprint(guestId, params.slug);

  const ipHash = clientIpHash(req);
  if (isRateLimited(`vote:${ipHash}`, 30, 60_000)) {
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

  // Tagesdeckel: wie viele Votes diese IP in dieser Feier in 24h abgegeben hat.
  // Macht automatisiertes Cookie-Rotieren spürbar teurer.
  const { rows: capRows } = await sql`
    SELECT COUNT(*)::int AS cnt
    FROM votes v
    JOIN songs s ON s.id = v.song_id
    JOIN events e ON e.id = s.event_id
    WHERE v.ip_hash = ${ipHash}
      AND e.slug = ${params.slug}
      AND v.created_at > NOW() - INTERVAL '24 hours'
  `;
  if ((capRows[0]?.cnt ?? 0) >= MAX_VOTES_PER_IP_PER_DAY) {
    const res = NextResponse.json({ error: 'rate_limited' }, { status: 429 });
    return attachGuestCookie(res, guestId, guestIdIsNew);
  }

  try {
    // Sicherheitsrelevant: INSERT ... SELECT bindet songId atomar an die Feier
    // aus dem Pfad. Vorher wurde songId ungeprüft eingefügt — ein beliebiger
    // slug + eine erratbare songId eines fremden Events konnte fremde Like-
    // Zähler manipulieren (songs.id ist SERIAL, also enumerierbar).
    const { rows } = await sql`
      INSERT INTO votes (song_id, voter_ip, ip_hash)
      SELECT ${songId}, ${fp}, ${ipHash}
      FROM songs s
      JOIN events e ON e.id = s.event_id
      WHERE s.id = ${songId}
        AND e.slug = ${params.slug}
      RETURNING id
    `;
    if (rows.length === 0) {
      const res = NextResponse.json({ error: 'not found' }, { status: 404 });
      return attachGuestCookie(res, guestId, guestIdIsNew);
    }
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '23505') {
      const res = NextResponse.json({ error: 'already voted' }, { status: 409 });
      return attachGuestCookie(res, guestId, guestIdIsNew);
    }
    throw err;
  }

  const res = NextResponse.json({ ok: true });
  return attachGuestCookie(res, guestId, guestIdIsNew);
}
