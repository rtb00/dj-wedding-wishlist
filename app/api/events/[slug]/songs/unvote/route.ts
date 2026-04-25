import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { getFingerprint } from '@/app/lib/fingerprint';

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await initDB();

  const fp = getFingerprint(req);
  const { songId } = await req.json();

  if (!songId) {
    return NextResponse.json({ error: 'songId required' }, { status: 400 });
  }

  await sql`
    DELETE FROM votes
    WHERE song_id = ${songId}
      AND voter_ip = ${fp}
  `;

  return NextResponse.json({ ok: true });
}
