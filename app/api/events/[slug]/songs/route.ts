import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { getFingerprint } from '@/app/lib/fingerprint';
import { containsProfanity } from '@/app/lib/profanity';

export async function GET(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await initDB();

  const fp = getFingerprint(req);

  const { rows } = await sql`
    SELECT
      s.id,
      s.title,
      s.artist,
      s.deezer_id,
      s.album_art_url,
      s.created_at,
      s.played,
      COUNT(v.id)::int AS vote_count,
      BOOL_OR(v.voter_ip = ${fp}) AS has_voted
    FROM songs s
    JOIN events e ON e.id = s.event_id
    LEFT JOIN votes v ON v.song_id = s.id
    WHERE e.slug = ${params.slug}
    GROUP BY s.id
    ORDER BY s.played ASC, vote_count DESC, s.created_at ASC
  `;

  return NextResponse.json(rows);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await initDB();

  const fp = getFingerprint(req);
  const body = await req.json();

  const { title, artist, deezerId, albumArt } = body as {
    title: string;
    artist: string;
    deezerId?: string;
    albumArt?: string;
  };

  // Validation
  if (!title?.trim() || !artist?.trim()) {
    return NextResponse.json({ error: 'title and artist required' }, { status: 400 });
  }
  if (title.trim().length > 200 || artist.trim().length > 200) {
    return NextResponse.json({ error: 'title/artist too long' }, { status: 400 });
  }

  // Profanity filter
  if (containsProfanity(title) || containsProfanity(artist)) {
    return NextResponse.json({ error: 'Bitte keine anstößigen Inhalte.' }, { status: 422 });
  }

  // Look up event
  const { rows: eventRows } = await sql`
    SELECT id FROM events WHERE slug = ${params.slug}
  `;
  if (eventRows.length === 0) {
    return NextResponse.json({ error: 'event not found' }, { status: 404 });
  }
  const eventId = eventRows[0].id;

  // Deezer duplicate check
  if (deezerId) {
    const { rows: dupeRows } = await sql`
      SELECT id FROM songs
      WHERE event_id = ${eventId}
        AND deezer_id = ${deezerId}
        AND played = FALSE
    `;
    if (dupeRows.length > 0) {
      const songId = dupeRows[0].id;
      // Auto-vote (ignore conflict if already voted)
      try {
        await sql`
          INSERT INTO votes (song_id, voter_ip)
          VALUES (${songId}, ${fp})
        `;
      } catch {
        // Already voted — ignore
      }
      return NextResponse.json({ duplicate: true, songId }, { status: 200 });
    }
  }

  // Manual duplicate check (no deezerId): case-insensitive title+artist, not played
  if (!deezerId) {
    const { rows: manualDupe } = await sql`
      SELECT id FROM songs
      WHERE event_id = ${eventId}
        AND played = FALSE
        AND LOWER(title) = LOWER(${title.trim()})
        AND LOWER(artist) = LOWER(${artist.trim()})
    `;
    if (manualDupe.length > 0) {
      const songId = manualDupe[0].id;
      try {
        await sql`
          INSERT INTO votes (song_id, voter_ip)
          VALUES (${songId}, ${fp})
        `;
      } catch {
        // Already voted — ignore
      }
      return NextResponse.json({ duplicate: true, songId }, { status: 200 });
    }
  }

  // Spam check: max 3 submissions per fingerprint per event
  const { rows: spamRows } = await sql`
    SELECT COUNT(*)::int AS cnt
    FROM songs
    WHERE event_id = ${eventId}
      AND submitter_ip = ${fp}
  `;
  if (spamRows[0].cnt >= 3) {
    return NextResponse.json(
      { error: 'Du hast bereits 3 Songs vorgeschlagen. Bitte warte etwas.' },
      { status: 429 }
    );
  }

  // Insert song
  const { rows: inserted } = await sql`
    INSERT INTO songs (event_id, title, artist, deezer_id, album_art_url, submitter_ip)
    VALUES (
      ${eventId},
      ${title.trim()},
      ${artist.trim()},
      ${deezerId ?? null},
      ${albumArt ?? null},
      ${fp}
    )
    RETURNING id
  `;
  const songId = inserted[0].id;

  // Auto-vote for submitter
  try {
    await sql`
      INSERT INTO votes (song_id, voter_ip)
      VALUES (${songId}, ${fp})
    `;
  } catch {
    // Ignore
  }

  return NextResponse.json({ songId }, { status: 201 });
}
