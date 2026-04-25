import { NextRequest, NextResponse } from 'next/server';
import { sql, initDB } from '@/app/lib/db';

function getIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

export async function POST(request: NextRequest) {
  await initDB();
  const ip = getIp(request);
  const { songId } = await request.json();

  try {
    await sql`INSERT INTO votes (song_id, voter_ip) VALUES (${songId}, ${ip})`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e?.code === '23505') {
      return NextResponse.json({ error: 'Bereits abgestimmt.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Fehler.' }, { status: 500 });
  }
}
