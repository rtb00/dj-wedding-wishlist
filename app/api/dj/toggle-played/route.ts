import { NextRequest, NextResponse } from 'next/server';
import { sql, initDB } from '@/app/lib/db';

const DJ_PASSWORD = 'hochzeit2027';

export async function POST(request: NextRequest) {
  const token = request.headers.get('x-dj-token');
  if (token !== DJ_PASSWORD) {
    return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
  }

  await initDB();
  const { songId } = await request.json();
  await sql`UPDATE songs SET played = NOT played WHERE id = ${songId}`;
  return NextResponse.json({ ok: true });
}
