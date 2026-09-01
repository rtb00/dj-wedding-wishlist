import type { Page, APIRequestContext, Browser } from '@playwright/test';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

// Gemeinsame Bausteine für die E2E-Tests. Alle Testkonten tragen das Präfix
// e2e., damit sie in der Datenbank als Testmüll erkennbar bleiben.

export function testEmail(tag: string): string {
  return `e2e.${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
}

export const TEST_PASSWORD = 'Test1234!e2e';

/** Registriert ein frisches Konto und wartet, bis der Zielbereich erreicht ist. */
export async function register(page: Page, email: string): Promise<void> {
  await page.goto('/auth/register');
  await page.fill('input[name=email]', email);
  await page.fill('input[name=password]', TEST_PASSWORD);
  await page.fill('input[name=confirm]', TEST_PASSWORD);
  for (const box of await page.locator('input[type=checkbox]').all()) await box.check();
  await page.click('button[type=submit]');
  await page.waitForURL((u) => /\/(dj|feier|pricing)/.test(u.toString()), { timeout: 30_000 });
}

export interface TestEvent {
  slug: string;
  title: string;
  dj_token?: string;
}

/** Legt ein Event über die API an und liefert slug samt DJ-Token. */
export async function createEvent(request: APIRequestContext, title = 'E2E Feier'): Promise<TestEvent> {
  const created = await (
    await request.post('/api/events', { data: { title, event_date: '2027-09-04' } })
  ).json();
  const info = await (await request.get(`/api/events/${created.slug}`)).json();
  return { slug: created.slug, title, dj_token: info.dj_token };
}

/**
 * Trägt Songs ein, verteilt auf mehrere frische Browser-Kontexte. Nötig, weil
 * ein Gast nur drei Wünsche eintragen darf: mehr Songs brauchen mehr Gäste.
 */
export async function seedSongs(browser: Browser, slug: string, guests: number): Promise<number> {
  let count = 0;
  for (let g = 0; g < guests; g++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (let i = 1; i <= 3; i++) {
      const res = await page.request.post(`/api/events/${slug}/songs`, {
        data: { title: `Wunsch ${g}-${i}`, artist: `Kuenstler ${g}${i}` },
      });
      if (res.ok()) count++;
    }
    await ctx.close();
  }
  return count;
}

export interface SongsResponse {
  songs: Array<{
    id: number;
    title: string;
    artist: string;
    vote_count: number | null;
    hidden: boolean;
    is_mine: boolean;
  }>;
  unlocked: boolean;
  total: number;
  hidden_count: number;
}

export async function fetchSongs(
  request: APIRequestContext,
  slug: string,
  view?: string,
  djToken?: string
): Promise<SongsResponse> {
  const params = new URLSearchParams();
  if (view) params.set('view', view);
  if (djToken) params.set('dj', djToken);
  const query = params.toString();
  const raw = await (await request.get(`/api/events/${slug}/songs${query ? `?${query}` : ''}`)).json();
  return Array.isArray(raw)
    ? { songs: raw, unlocked: false, total: raw.length, hidden_count: 0 }
    : raw;
}

/** Titel, die tatsächlich lesbar zurückkamen (versteckte sind serverseitig leer). */
export function readableTitles(res: SongsResponse): string[] {
  return res.songs.filter((s) => s.title && s.title.length > 0).map((s) => s.title);
}

/** Deaktiviert das Testevent wieder, damit die Datenbank nicht zuwächst. */
export async function cleanup(request: APIRequestContext, slug: string): Promise<void> {
  await request.patch(`/api/events/${slug}`, { data: { active: false } }).catch(() => {});
}

export interface Me {
  id: string;
  plan: 'free' | 'pro' | 'event_pass' | 'studio';
  planStatus: string | null;
  eventCredits: number;
  isCouple: boolean;
  limits: { maxEvents: number | null; maxSongs: number | null; export: boolean };
}

export async function getMe(request: APIRequestContext): Promise<Me> {
  return (await (await request.get('/api/me')).json()) as Me;
}

// --- Stripe-Webhook-Simulation ----------------------------------------------
// Guthaben, Freischaltung und Plan-Wechsel entstehen in Produktion aus genau
// einem Ort: app/api/stripe/webhook/route.ts. Statt eines Test-only-Bypasses
// senden diese Helfer signierte Testereignisse an exakt diese Route — der
// reale Code läuft also mit, nicht eine Kopie seines Verhaltens. Das Secret
// liegt in .env.local (wie bei den Skripten unter scripts/); der
// Playwright-Testprozess liest .env.local nicht automatisch ein wie der
// Next-Dev-Server, darum hier von Hand geladen.
let cachedWebhookSecret: string | null | undefined;

function webhookSecret(): string | null {
  if (cachedWebhookSecret !== undefined) return cachedWebhookSecret;
  try {
    const text = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8');
    const match = text.match(/^STRIPE_WEBHOOK_SECRET=(.+)$/m);
    cachedWebhookSecret = match ? match[1].trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    cachedWebhookSecret = null;
  }
  return cachedWebhookSecret;
}

/** true, wenn ein Webhook-Secret gefunden wurde und signierte Ereignisse möglich sind. */
export function webhooksAvailable(): boolean {
  return webhookSecret() !== null;
}

async function sendSignedStripeEvent(
  request: APIRequestContext,
  type: string,
  dataObject: Record<string, unknown>
): Promise<{ ok: boolean; status: number }> {
  const secret = webhookSecret();
  if (!secret) return { ok: false, status: 0 };
  const payload = JSON.stringify({
    id: `evt_e2e_${randomUUID()}`,
    object: 'event',
    type,
    data: { object: dataObject },
  });
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  const res = await request.post('/api/stripe/webhook', {
    data: payload,
    headers: { 'Content-Type': 'application/json', 'stripe-signature': header },
  });
  return { ok: res.ok(), status: res.status() };
}

/**
 * Simuliert einen abgeschlossenen Checkout, so wie ihn Stripe nach einem
 * echten Kauf schickt. metadata.tier='credit_pack_5' schreibt nur Guthaben
 * gut, metadata.gift_credit='1' schenkt ein Event zusätzlich zum gewählten
 * Tarif, metadata.slug schaltet eine konkrete Feier frei — alles Metadaten,
 * die der reale Checkout ebenfalls setzt.
 */
export async function sendCheckoutCompleted(
  request: APIRequestContext,
  userId: string,
  metadata: Record<string, string> = {},
  customerId = `cus_e2e_${randomUUID()}`
): Promise<{ ok: boolean; status: number }> {
  return sendSignedStripeEvent(request, 'checkout.session.completed', {
    id: `cs_e2e_${randomUUID()}`,
    object: 'checkout.session',
    mode: 'payment',
    customer: customerId,
    client_reference_id: userId,
    metadata: { user_id: userId, ...metadata },
  });
}

/** Simuliert eine aktive Stripe-Subscription (setzt den Plan auf pro/studio). */
export async function sendSubscriptionActive(
  request: APIRequestContext,
  userId: string,
  customerId: string,
  currentPeriodEndUnix: number
): Promise<{ ok: boolean; status: number }> {
  // tierForPrice ist seit dem Fail-Closed-Fix streng: unbekannte Price-IDs
  // ändern den Plan nicht mehr. Der Helper nutzt deshalb die echte konfigurierte
  // Pro-Price-ID aus .env.local, damit der Subscription-Flow greift.
  const envFile = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  const priceMatch = envFile.match(/^STRIPE_PRICE_PRO_MONTHLY=(.+)$/m);
  const proPriceId = priceMatch?.[1]?.trim() ?? 'price_e2e_fake';
  return sendSignedStripeEvent(request, 'customer.subscription.updated', {
    id: `sub_e2e_${randomUUID()}`,
    object: 'subscription',
    status: 'active',
    customer: customerId,
    metadata: { user_id: userId },
    cancel_at_period_end: false,
    items: {
      object: 'list',
      data: [
        {
          price: { id: proPriceId, recurring: { interval: 'month' } },
          current_period_end: currentPeriodEndUnix,
        },
      ],
    },
  });
}

/** Simuliert eine fehlgeschlagene Zahlung (setzt plan_status auf past_due). */
export async function sendPaymentFailed(
  request: APIRequestContext,
  customerId: string
): Promise<{ ok: boolean; status: number }> {
  return sendSignedStripeEvent(request, 'invoice.payment_failed', {
    id: `in_e2e_${randomUUID()}`,
    object: 'invoice',
    customer: customerId,
  });
}

/** Sammelt Konsolenfehler und unbehandelte Fehler einer Seite ab jetzt. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return errors;
}
