import { sql } from '@vercel/postgres';

export { sql };

let initialized = false;

export async function initDB() {
  if (initialized) return;

  await sql`
    CREATE TABLE IF NOT EXISTS songs (
      id         SERIAL PRIMARY KEY,
      title      TEXT NOT NULL,
      artist     TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      played     BOOLEAN DEFAULT FALSE,
      submitter_ip TEXT
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS votes (
      id         SERIAL PRIMARY KEY,
      song_id    INTEGER REFERENCES songs(id) ON DELETE CASCADE,
      voter_ip   TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (song_id, voter_ip)
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_votes_song ON votes(song_id)`;

  initialized = true;
}
