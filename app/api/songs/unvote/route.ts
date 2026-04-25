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

  await sql`DELETE FROM votes WHERE song_id = ${songId} AND voter_ip = ${ip}`;
  return NextResponse.json({ ok: true });
}
