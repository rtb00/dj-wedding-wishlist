import { NextResponse } from 'next/server';
import { initDB, sql } from '@/app/lib/db';
import { auth } from '@/auth';
import { getEffectivePlan, getPlanLimits } from '@/app/lib/plans';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await initDB();

  const { rows } = await sql`
    SELECT id, name, email, plan, plan_status, current_period_end,
           cancel_at_period_end, branding_name, branding_logo_url, subdomain,
           event_credits, is_couple, password
    FROM users
    WHERE id = ${session.user.id}
  `;
  const user = rows[0];
  if (!user) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const plan = getEffectivePlan({
    plan: user.plan,
    plan_status: user.plan_status,
    current_period_end: user.current_period_end,
  });
  const limits = getPlanLimits(plan);

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    plan,
    rawPlan: user.plan,
    planStatus: user.plan_status,
    currentPeriodEnd: user.current_period_end,
    cancelAtPeriodEnd: user.cancel_at_period_end,
    brandingName: user.branding_name,
    brandingLogoUrl: user.branding_logo_url,
    subdomain: user.subdomain,
    eventCredits: user.event_credits ?? 0,
    // Merkmal aus der Registrierung: ein Paar gehört nach /feier, nicht ins
    // DJ-Dashboard.
    isCouple: user.is_couple === true,
    // Nur ein Ja/Nein-Flag für den Lösch-Dialog (Passwortbestätigung) — der
    // Hash selbst verlässt den Server nicht.
    hasPassword: !!user.password,
    limits: {
      maxEvents: Number.isFinite(limits.maxEvents) ? limits.maxEvents : null,
      maxSongs: Number.isFinite(limits.maxSongs) ? limits.maxSongs : null,
      branding: limits.branding,
      export: limits.export,
      maxSubAccounts: Number.isFinite(limits.maxSubAccounts) ? limits.maxSubAccounts : null,
      customDomain: limits.customDomain,
    },
  });
}
