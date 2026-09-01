import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { isRateLimited } from '@/app/lib/rate-limit';
import { clientIp, clientIpHash } from '@/app/lib/security';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL,
  max: 3,
});

async function ensureUsersTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      name            TEXT,
      email           TEXT UNIQUE,
      "emailVerified" TIMESTAMPTZ,
      image           TEXT,
      password        TEXT
    )
  `);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_couple BOOLEAN NOT NULL DEFAULT FALSE`);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// bcryptjs schneidet stillschweigend bei 72 Bytes ab — alles darüber
// verhält sich wie sein Präfix. Wir lehnen es lieber sauber ab.
const MAX_PASSWORD_BYTES = 72;
const BCRYPT_ROUNDS = 12;
// Einheitliche Antwort für alle "Konto existiert schon"-Fälle: verhindert
// E-Mail-Enumeration (a=409 mit unterschiedlichem Text würde Konten bestätigen).
const CONFLICT_MESSAGE =
  'Diese E-Mail-Adresse kann nicht registriert werden. Falls sie bereits registriert ist, melde dich einfach an.';

export async function POST(req: NextRequest) {
  // Rate-Limit VOR dem bcrypt-Call: ohne Limit ist die teure Hash-Berechnung
  // ein CPU-DoS-Vektor für unauthentifizierte Aufrufer. e2e-Suiten
  // registrieren ~20 Konten pro Lauf von localhost — per Env erhöhbar.
  const ip = clientIp(req);
  const maxRegistrations = Number.parseInt(
    process.env.BEATCONTROL_MAX_REGISTRATIONS_15MIN ?? '30',
    10
  );
  if (isRateLimited(`register:${ip}`, maxRegistrations, 15 * 60_000)) {
    return NextResponse.json({ error: 'Zu viele Versuche. Bitte später erneut.' }, { status: 429 });
  }

  let body: { email?: unknown; password?: unknown; name?: unknown; is_couple?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Ungültige Anfrage' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const isCouple = body.is_couple === true;

  if (!email || !EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Bitte eine gültige Email-Adresse angeben.' }, { status: 400 });
  }
  if (password.length < 8 || Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return NextResponse.json(
      { error: 'Passwort muss mindestens 8 und höchstens 72 Zeichen lang sein.' },
      { status: 400 }
    );
  }
  if (name.length > 100) {
    return NextResponse.json({ error: 'Name zu lang.' }, { status: 400 });
  }

  await ensureUsersTable();

  const { rows: existing } = await pool.query<{ id: string; password: string | null }>(
    `SELECT id, password FROM users WHERE email = $1 LIMIT 1`,
    [email]
  );

  if (existing[0]) {
    // Sicherheitsrelevant: bestehende Konten bekommen hier NIEMALS ein
    // Passwort gesetzt. Vorher fiel der Fall "OAuth-Konto ohne Passwort"
    // (z.B. Google-Login) in den UPDATE-Zweig — jeder, der nur die E-Mail
    // kannte, konnte einem fremden Konto ein Passwort unterschieben und sich
    // danach per Credentials-Login einloggen. Ein Passwort für ein bestehendes
    // Konto gibt es nur über einen verifizierten Kanal; den gibt es aktuell
    // nicht, also wird der Weg geschlossen. Identische Antwort in beiden
    // Fällen = keine E-Mail-Enumeration.
    console.warn('[register] blocked registration attempt for existing account', {
      ip: clientIpHash(req),
      hasPassword: !!existing[0].password,
    });
    return NextResponse.json({ error: CONFLICT_MESSAGE }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  await pool.query(
    `INSERT INTO users (email, password, name, is_couple) VALUES ($1, $2, NULLIF($3, ''), $4)`,
    [email, hash, name, isCouple]
  );

  return NextResponse.json({ ok: true });
}
