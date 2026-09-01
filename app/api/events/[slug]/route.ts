import { NextRequest, NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { auth } from '@/auth';
import { getEffectivePlan, getPlanLimits } from '@/app/lib/plans';
import { isUnlocked } from '@/app/lib/visibility';

export async function GET(
  _req: NextRequest,
  { params }: { params: { slug: string } }
) {
  await initDB();

  const { rows } = await sql`
    SELECT
      e.id, e.slug, e.title, e.active, e.event_date, e.created_at, e.credit_redeemed,
      e.unlocked_at, e.dj_id, e.dj_token,
      u.plan AS owner_plan,
      u.plan_status AS owner_plan_status,
      u.current_period_end AS owner_current_period_end,
      u.branding_name AS owner_branding_name,
      u.branding_logo_url AS owner_branding_logo_url
    FROM events e
    LEFT JOIN users u ON u.id = e.dj_id
    WHERE e.slug = ${params.slug}
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const row = rows[0];

  let brandingName: string | null = null;
  let brandingLogoUrl: string | null = null;
    // Nur Team (studio) ist Whitelabel: dort verschwindet der BeatControl-Hinweis
    // auf der Gäste-Seite komplett.
    let whitelabel = false;
    const ownerPlan = row.owner_plan
      ? {
          plan: row.owner_plan,
          plan_status: row.owner_plan_status,
          current_period_end: row.owner_current_period_end,
        }
      : null;
    if (ownerPlan) {
      const plan = getEffectivePlan(ownerPlan);
      // Per Guthaben freigeschaltete Events tragen wie Event-Pass-Events das DJ-Branding.
      if (getPlanLimits(plan).branding || row.credit_redeemed === true) {
        brandingName = row.owner_branding_name ?? null;
        // Legacy-Logos mit http:// werden von der CSP blockiert — nicht
        // ausliefern, sonst bricht das Layout (leeres <img>).
        brandingLogoUrl =
          typeof row.owner_branding_logo_url === 'string' && row.owner_branding_logo_url.startsWith('https://')
            ? row.owner_branding_logo_url
            : null;
      }
      whitelabel = plan === 'studio';
    }

  const unlocked = isUnlocked(ownerPlan, row.credit_redeemed === true, row.unlocked_at);

  // Das DJ-Token verlässt den Server nur Richtung Owner — damit teilt das
  // Brautpaar den Live-Screen mit seinem DJ, ohne Zugangsdaten weiterzugeben.
  const session = await auth();
  const isOwner = !!session?.user?.id && session.user.id === row.dj_id;

  return NextResponse.json({
    id: row.id,
    slug: row.slug,
    title: row.title,
    active: row.active,
    event_date: row.event_date,
    created_at: row.created_at,
    branding_name: brandingName,
    branding_logo_url: brandingLogoUrl,
    whitelabel,
    unlocked,
    ...(isOwner ? { dj_token: row.dj_token } : {}),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await initDB();

  const body = await req.json().catch(() => ({}));
  const { active, title, event_date } = body as {
    active?: boolean;
    title?: string;
    event_date?: string | null;
  };

  if (title !== undefined && (typeof title !== 'string' || title.trim().length > 200)) {
    return NextResponse.json({ error: 'title too long' }, { status: 400 });
  }

  let normalizedDate: string | null | undefined = undefined;
  if (event_date === null) {
    normalizedDate = null;
  } else if (typeof event_date === 'string') {
    const d = new Date(event_date);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: 'invalid event_date' }, { status: 400 });
    }
    normalizedDate = event_date.slice(0, 10);
  }

  const { rows } = await sql`
    UPDATE events
    SET
      active     = COALESCE(${active ?? null}, active),
      title      = COALESCE(${title?.trim() ?? null}, title),
      event_date = CASE
        WHEN ${normalizedDate === undefined ? '__keep__' : 'set'} = 'set'
        THEN ${normalizedDate ?? null}::date
        ELSE event_date
      END
    WHERE slug = ${params.slug}
      AND dj_id = ${session.user.id}
    RETURNING id, slug, title, active, event_date, created_at
  `;

  if (rows.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  return NextResponse.json(rows[0]);
}
