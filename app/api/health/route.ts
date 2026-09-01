import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

// Public health-check endpoint for external monitoring (UptimeRobot, BetterStack, etc.).
// Returns 200 if DB is reachable, 503 if not. Never exposes user data.
// Cache-Control: no-store so monitors get fresh data every call.

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  try {
    // Lightweight DB-ping. SELECT 1 is cheap, doesn't lock anything.
    await sql`SELECT 1`;
    return NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - started,
        version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (err) {
    // Details nur serverseitig — interne DB-Fehlermeldungen (Host, Region,
    // SSL-Details von @vercel/postgres) gehören nicht in öffentliche Antworten.
    console.error('[health] db check failed', err);
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        latencyMs: Date.now() - started,
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
