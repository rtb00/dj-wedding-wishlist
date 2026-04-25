import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await initDB();

  const { rows } = await sql`
    SELECT id, slug, title, subtitle, active, created_at
    FROM events
    WHERE slug = ${params.slug}
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await initDB();

  const body = await req.json();
  const { active, title, subtitle } = body as {
    active?: boolean;
    title?: string;
    subtitle?: string;
  };

  const { rows } = await sql`
    UPDATE events
    SET
      active   = COALESCE(${active ?? null}, active),
      title    = COALESCE(${title?.trim() ?? null}, title),
      subtitle = CASE
        WHEN ${subtitle !== undefined} THEN ${subtitle?.trim() ?? null}
        ELSE subtitle
      END
    WHERE slug = ${params.slug}
    RETURNING id, slug, title, subtitle, active, created_at
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
