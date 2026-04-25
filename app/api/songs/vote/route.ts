import { NextRequest, NextResponse } from 'next/server';
import { sql, initDB } from '@/app/lib/db';
import { getFingerprint } from '@/app/lib/fingerprint';

export async function POST(request: NextRequest) {
  await initDB();
  const fp = getFingerprint(request);
  const { songId } = await request.json();

  try {
    await sql`INSERT INTO votes (song_id, voter_ip) VALUES (${songId}, ${fp})`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === '23505') {
      return NextResponse.json({ error: 'Bereits abgestimmt.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Fehler.' }, { status: 500 });
  }
}
