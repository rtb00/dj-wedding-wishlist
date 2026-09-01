import NextAuth, { type DefaultSession } from 'next-auth';
import Google from 'next-auth/providers/google';
import Apple from 'next-auth/providers/apple';
import Credentials from 'next-auth/providers/credentials';
import PostgresAdapter from '@auth/pg-adapter';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { authConfig } from './auth.config';
import { isRateLimited } from './app/lib/rate-limit';

declare module 'next-auth' {
  interface Session {
    user: { id: string } & DefaultSession['user'];
  }
}


const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL,
  max: 3,
});

let schemaReady: Promise<void> | null = null;
async function ensureAuthSchema() {
  if (!schemaReady) {
    schemaReady = (async () => {
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
      const { rows } = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name='accounts' AND column_name='id'`
      );
      if (rows.length === 0) {
        await pool.query(`DROP TABLE IF EXISTS accounts`);
      }
      await pool.query(`
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
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          "sessionToken" TEXT PRIMARY KEY,
          "userId"       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires        TIMESTAMPTZ NOT NULL
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS verification_tokens (
          identifier TEXT NOT NULL,
          token      TEXT NOT NULL,
          expires    TIMESTAMPTZ NOT NULL,
          PRIMARY KEY (identifier, token)
        )
      `);
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const baseAdapter = PostgresAdapter(pool);
const adapter: typeof baseAdapter = Object.fromEntries(
  Object.entries(baseAdapter).map(([key, fn]) => [
    key,
    typeof fn === 'function'
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (async (...args: any[]) => {
          await ensureAuthSchema();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (fn as any)(...args);
        })
      : fn,
  ])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) as any;

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter,
  providers: [
    // allowDangerousEmailAccountLinking: Google liefert ausschließlich
    // verifizierte E-Mails, daher ist das automatische Verknüpfen mit einem
    // bestehenden Passwort-Account gleicher E-Mail hier sicher. Ohne dies
    // scheitert der Google-Login für jeden, der sich zuerst per E-Mail
    // registriert hat (OAuthAccountNotLinked -> "Anmeldung fehlgeschlagen").
    Google({ allowDangerousEmailAccountLinking: true }),
    ...(process.env.AUTH_APPLE_ID ? [Apple] : []),
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Passwort', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email.trim().toLowerCase() : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!email || !password) return null;

        // Brute-Force/Credential-Stuffing-Bremse: pro E-Mail maximal 10
        // Loginversuche pro 5 Minuten (in-memory, pro Serverless-Instanz —
        // besser als nichts, ein verteiltes Limit ist der Folge-Schritt).
        if (isRateLimited(`login:${email}`, 10, 5 * 60_000)) return null;

        await ensureAuthSchema();
        const { rows } = await pool.query<{
          id: string;
          name: string | null;
          email: string;
          image: string | null;
          password: string | null;
        }>(
          `SELECT id, name, email, image, password FROM users WHERE email = $1 LIMIT 1`,
          [email]
        );
        const user = rows[0];
        if (!user || !user.password) return null;

        const ok = await bcrypt.compare(password, user.password);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    ...authConfig.callbacks,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jwt({ token, user }: any) {
      if (user?.id) token.id = user.id;
      return token;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    session({ session, token }: any) {
      if (token?.id) session.user.id = token.id;
      return session;
    },
  },
});
