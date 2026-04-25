import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';

export async function GET() {
  await initDB();

  const { rows } = await sql`
    SELECT
      e.id,
      e.slug,
      e.title,
      e.subtitle,
      e.active,
      e.created_at,
      COUNT(s.id)::int AS song_count
    FROM events e
    LEFT JOIN songs s ON s.event_id = e.id
    GROUP BY e.id
    ORDER BY e.active DESC, e.created_at DESC
  `;

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  await initDB();

  const body = await req.json();
  const { title, subtitle, slug, djPassword } = body as {
    title: string;
    subtitle?: string;
    slug: string;
    djPassword?: string;
  };

  if (!title?.trim()) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }

  // Validate slug: only lowercase a-z, 0-9, hyphens; min 2 chars
  if (!slug || !/^[a-z0-9][a-z0-9-]{1,}$/.test(slug)) {
    return NextResponse.json(
      { error: 'slug must be at least 2 chars and contain only a-z, 0-9, hyphens' },
      { status: 400 }
    );
  }

  try {
    const { rows } = await sql`
      INSERT INTO events (slug, title, subtitle, dj_password)
      VALUES (
        ${slug},
        ${title.trim()},
        ${subtitle?.trim() ?? null},
        ${djPassword?.trim() || 'hochzeit2027'}
      )
      RETURNING id, slug, title, subtitle, active, created_at
    `;
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === '23505') {
      return NextResponse.json({ error: 'slug already taken' }, { status: 409 });
    }
    throw err;
  }
}
