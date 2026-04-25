import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await initDB();

  const token = req.headers.get('x-dj-token') ?? '';
  const { songId } = await req.json();

  if (!songId) {
    return NextResponse.json({ error: 'songId required' }, { status: 400 });
  }

  // Look up event password by slug
  const { rows: eventRows } = await sql`
    SELECT dj_password FROM events WHERE slug = ${params.slug}
  `;
  if (eventRows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  if (eventRows[0].dj_password !== token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  await sql`
    UPDATE songs
    SET played = NOT played
    WHERE id = ${songId}
      AND event_id = (SELECT id FROM events WHERE slug = ${params.slug})
  `;

  return NextResponse.json({ ok: true });
}
