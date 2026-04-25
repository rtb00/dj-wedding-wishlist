import { sql } from '@vercel/postgres';

export { sql };

let initialized = false;

export async function initDB() {
  if (initialized) return;

  // Check if events table already exists
  const { rows } = await sql`
    SELECT to_regclass('public.events') IS NOT NULL AS has_events
  `;
  const hasEvents = rows[0]?.has_events === true;

  if (!hasEvents) {
    // Migrate from old schema: drop legacy tables before recreating
    await sql`DROP TABLE IF EXISTS votes`;
    await sql`DROP TABLE IF EXISTS songs`;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id          SERIAL PRIMARY KEY,
      slug        TEXT UNIQUE NOT NULL,
      title       TEXT NOT NULL,
      subtitle    TEXT,
      dj_password TEXT NOT NULL DEFAULT 'hochzeit2027',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      active      BOOLEAN DEFAULT TRUE
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS songs (
      id            SERIAL PRIMARY KEY,
      event_id      INTEGER REFERENCES events(id) ON DELETE CASCADE NOT NULL,
      title         TEXT NOT NULL,
      artist        TEXT NOT NULL,
      deezer_id     TEXT,
      album_art_url TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      played        BOOLEAN DEFAULT FALSE,
      submitter_ip  TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS votes (
      id         SERIAL PRIMARY KEY,
      song_id    INTEGER REFERENCES songs(id) ON DELETE CASCADE,
      voter_ip   TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(song_id, voter_ip)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_votes_song ON votes(song_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_songs_event ON songs(event_id)`;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_songs_event_deezer
    ON songs(event_id, deezer_id)
    WHERE deezer_id IS NOT NULL
  `;

  initialized = true;
}
