import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await initDB();

  const { password } = await req.json();

  const { rows } = await sql`
    SELECT dj_password FROM events WHERE slug = ${params.slug}
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  if (rows[0].dj_password !== password) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
