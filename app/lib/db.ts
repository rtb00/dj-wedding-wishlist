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
      suggestions   TEXT,
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

  // Column migrations for existing installs (idempotent)
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS suggestions TEXT`;

  // Gehashte Client-IP für Tagesdeckeln gegen Ballot-Stuffing/Song-Spam
  // (siehe app/lib/security.ts — keine Klartext-IPs in der DB).
  await sql`ALTER TABLE votes ADD COLUMN IF NOT EXISTS ip_hash TEXT`;
  await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS ip_hash TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS idx_votes_ip_hash ON votes(ip_hash, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_songs_ip_hash ON songs(ip_hash, created_at)`;

  // Auth.js tables
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name            TEXT,
      email           TEXT UNIQUE,
      "emailVerified" TIMESTAMPTZ,
      image           TEXT,
      password        TEXT
    )
  `;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`;
  // Migration: @auth/pg-adapter requires accounts.id — drop and recreate if missing
  const { rows: accountIdCheck } = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'id'
  `;
  if (accountIdCheck.length === 0) {
    await sql`DROP TABLE IF EXISTS accounts`;
  }
  await sql`
    CREATE TABLE IF NOT EXISTS accounts (
      id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      "userId"            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type                TEXT NOT NULL,
      provider            TEXT NOT NULL,
      "providerAccountId" TEXT NOT NULL,
      refresh_token       TEXT,
      access_token        TEXT,
      expires_at          INTEGER,
      token_type          TEXT,
      scope               TEXT,
      id_token            TEXT,
      session_state       TEXT,
      UNIQUE (provider, "providerAccountId")
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      "sessionToken" TEXT PRIMARY KEY,
      "userId"       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires        TIMESTAMPTZ NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS verification_tokens (
      identifier TEXT NOT NULL,
      token      TEXT NOT NULL,
      expires    TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (identifier, token)
    )
  `;

  // events.dj_id ownership column (idempotent)
  const { rows: evtCols } = await sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'dj_id'
  `;
  if (evtCols.length === 0) {
    await sql`ALTER TABLE events ADD COLUMN dj_id UUID NOT NULL`;
  } else if (evtCols[0].data_type === 'text') {
    // Convert legacy TEXT column to UUID so we can add a real FK to users.id
    try {
      await sql`ALTER TABLE events ALTER COLUMN dj_id TYPE UUID USING dj_id::uuid`;
    } catch {
      // If conversion fails (orphan data), leave as text — FK add below will be skipped.
    }
  }

  // FK: events.dj_id → users.id ON DELETE CASCADE (idempotent)
  const { rows: fkRows } = await sql`
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'events' AND constraint_name = 'events_dj_id_fkey'
  `;
  if (fkRows.length === 0) {
    try {
      await sql`
        ALTER TABLE events
        ADD CONSTRAINT events_dj_id_fkey
        FOREIGN KEY (dj_id) REFERENCES users(id) ON DELETE CASCADE
      `;
    } catch {
      // Ignore if column types are incompatible — surfaced via logs in production.
    }
  }

  // Drop legacy per-event password column if it still exists
  await sql`ALTER TABLE events DROP COLUMN IF EXISTS dj_password`;

  // Event date for event-pass validity window
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS event_date DATE`;

  // Plan / billing columns on users
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free'`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_status TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_id TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE`;
  // Which price the active subscription is on (monthly vs yearly) + the interval.
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS current_price_id TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS billing_cycle TEXT`;
  // Brautpaar-Konto: unterscheidet Paare von DJs (andere Ansprache, andere Ansicht)
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_couple BOOLEAN NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS branding_name TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS branding_logo_url TEXT`;

  // DJ-Link: geheimes Token pro Event, mit dem der Live-Screen ohne Account
  // bedient werden kann (Brautpaar teilt den Link mit seinem DJ).
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS dj_token TEXT`;
  await sql`UPDATE events SET dj_token = md5(random()::text || clock_timestamp()::text || id::text) WHERE dj_token IS NULL`;

  // Credit-Packs: gekauftes Event-Guthaben am Nutzer, Einlösung markiert das
  // einzelne Event dauerhaft als freigeschaltet (verhält sich wie Event-Pass).
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS event_credits INT NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS credit_redeemed BOOLEAN NOT NULL DEFAULT FALSE`;

  // Freischaltung hängt an der Feier, nicht am Konto: Paar oder DJ können
  // beide zahlen, beide schalten dieselbe Feier frei.
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ`;

  // Studio-Tier: Subdomain für Whitelabel-Routing (kundenname.beatcontrol.io)
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS subdomain TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_subdomain ON users(LOWER(subdomain)) WHERE subdomain IS NOT NULL`;

  // Stripe webhook idempotency
  await sql`
    CREATE TABLE IF NOT EXISTS stripe_events (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      received_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS waitlist (
      id              SERIAL PRIMARY KEY,
      email           TEXT NOT NULL,
      selected_tier   TEXT,
      pricing_variant TEXT,
      utm_source      TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS analytics (
      id              SERIAL PRIMARY KEY,
      event_type      TEXT NOT NULL,
      pricing_variant TEXT,
      tier_clicked    TEXT,
      fingerprint     TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    )
  `;

  initialized = true;
}
