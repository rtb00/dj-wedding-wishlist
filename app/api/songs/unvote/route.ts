import { NextRequest, NextResponse } from 'next/server';
import { sql, initDB } from '@/app/lib/db';
import { getFingerprint } from '@/app/lib/fingerprint';

export async function POST(request: NextRequest) {
  await initDB();
  const fp = getFingerprint(request);
  const { songId } = await request.json();

  await sql`DELETE FROM votes WHERE song_id = ${songId} AND voter_ip = ${fp}`;
  return NextResponse.json({ ok: true });
}
