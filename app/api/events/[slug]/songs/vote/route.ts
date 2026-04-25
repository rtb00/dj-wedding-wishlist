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

  try {
    await sql`
      INSERT INTO votes (song_id, voter_ip)
      VALUES (${songId}, ${fp})
    `;
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '23505') {
      return NextResponse.json({ error: 'already voted' }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ ok: true });
}
