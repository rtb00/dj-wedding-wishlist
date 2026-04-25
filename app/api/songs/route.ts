import { NextRequest, NextResponse } from 'next/server';
import { sql, initDB } from '@/app/lib/db';
import { containsProfanity } from '@/app/lib/profanity';
import { getFingerprint } from '@/app/lib/fingerprint';

export async function GET(request: NextRequest) {
  await initDB();
  const ip = getFingerprint(request);

  const { rows } = await sql`
    SELECT
      s.id,
      s.title,
      s.artist,
      s.created_at,
      s.played,
      COUNT(v.id)::int                                              AS vote_count,
      EXISTS(SELECT 1 FROM votes WHERE song_id = s.id AND voter_ip = ${ip}) AS has_voted
    FROM songs s
    LEFT JOIN votes v ON v.song_id = s.id
    GROUP BY s.id
    ORDER BY s.played ASC, COUNT(v.id) DESC, s.created_at ASC
  `;

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  await initDB();
  const ip = getFingerprint(request);

  const body = await request.json();
  const title = String(body.title ?? '').trim().slice(0, 200);
  const artist = String(body.artist ?? '').trim().slice(0, 200);

  if (!title || !artist) {
    return NextResponse.json({ error: 'Bitte Titel und Künstler eingeben.' }, { status: 400 });
  }

  if (containsProfanity(title) || containsProfanity(artist)) {
    return NextResponse.json({ error: 'Bitte angemessene Sprache verwenden.' }, { status: 400 });
  }

  // Duplicate check (case-insensitive)
  const { rows: existing } = await sql`
    SELECT id FROM songs
    WHERE LOWER(title) = LOWER(${title}) AND LOWER(artist) = LOWER(${artist})
    LIMIT 1
  `;

  if (existing.length > 0) {
    const songId = existing[0].id;
    try {
      await sql`INSERT INTO votes (song_id, voter_ip) VALUES (${songId}, ${ip})`;
    } catch {
      // Already voted – that's fine
    }
    return NextResponse.json({ duplicate: true, songId });
  }

  // Spam check: max 3 submissions per IP
  const { rows: countRows } = await sql`
    SELECT COUNT(*)::int AS cnt FROM songs WHERE submitter_ip = ${ip}
  `;
  if (countRows[0].cnt >= 3) {
    return NextResponse.json(
      { error: 'Du hast bereits 3 Songs vorgeschlagen – danke!' },
      { status: 429 }
    );
  }

  const { rows: [song] } = await sql`
    INSERT INTO songs (title, artist, submitter_ip)
    VALUES (${title}, ${artist}, ${ip})
    RETURNING *
  `;

  // Auto-vote for submitter
  await sql`INSERT INTO votes (song_id, voter_ip) VALUES (${song.id}, ${ip})`;

  return NextResponse.json({ ...song, vote_count: 1, has_voted: true }, { status: 201 });
}
