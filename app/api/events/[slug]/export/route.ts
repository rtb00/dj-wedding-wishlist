import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { auth } from '@/auth';
import { getEffectivePlan, getPlanLimits } from '@/app/lib/plans';
import { isUnlocked } from '@/app/lib/visibility';

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  // Spreadsheet-Formel-Injection: Zellen, die mit = + - @ Tab oder CR beginnen,
  // werden von Excel/LibreOffice als Formel ausgeführt (=WEBSERVICE(...) leakt
  // Daten an fremde Server). Ein führendes ' erzwingt Text-Interpretation.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  if (/[",\n;]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await initDB();

  const { rows: ownerRows } = await sql`
    SELECT u.id, u.plan, u.plan_status, u.current_period_end,
           e.id AS event_id, e.title AS event_title, e.credit_redeemed, e.unlocked_at
    FROM users u
    JOIN events e ON e.dj_id = u.id
    WHERE u.id = ${session.user.id}
      AND e.slug = ${params.slug}
  `;
  if (ownerRows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  const owner = ownerRows[0];

  const plan = getEffectivePlan({
    plan: owner.plan,
    plan_status: owner.plan_status,
    current_period_end: owner.current_period_end,
  });
  const limits = getPlanLimits(plan);
  // Per Guthaben freigeschaltete Events dürfen wie Event-Pass-Events exportieren.
  if (!limits.export && owner.credit_redeemed !== true) {
    return NextResponse.json({ error: 'plan_limit', limit: 'export' }, { status: 402 });
  }

  // Nicht freigeschaltete Feiern exportieren ohne Titel: der Export darf die
  // Bezahlschranke der Songs-API nicht umgehen.
  const unlocked = isUnlocked(
    { plan: owner.plan, plan_status: owner.plan_status, current_period_end: owner.current_period_end },
    owner.credit_redeemed === true,
    owner.unlocked_at
  );

  const { rows: songs } = await sql`
    SELECT
      s.title,
      s.artist,
      s.created_at,
      s.played,
      COUNT(v.id)::int AS vote_count
    FROM songs s
    LEFT JOIN votes v ON v.song_id = s.id
    WHERE s.event_id = ${owner.event_id}
    GROUP BY s.id
    ORDER BY s.played ASC, vote_count DESC, s.created_at ASC
  `;

  const header = ['Titel', 'Artist', 'Stimmen', 'Eingegangen', 'Gespielt'];
  const lines = [
    '﻿' + header.join(';'),
    ...songs.map((row) =>
      [
        csvEscape(unlocked ? row.title : ''),
        csvEscape(unlocked ? row.artist : ''),
        csvEscape(row.vote_count),
        csvEscape(new Date(row.created_at as string).toLocaleString('de-DE')),
        csvEscape(row.played ? 'ja' : 'nein'),
      ].join(';')
    ),
  ];
  const csv = lines.join('\r\n');

  const filename = `wunschliste-${params.slug}.csv`;
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
