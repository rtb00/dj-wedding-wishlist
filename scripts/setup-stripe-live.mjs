// Einmalskript für die Live-Umstellung: legt im Stripe-LIVE-Modus alle
// Produkte, Preise und den Webhook-Endpoint an und gibt die fertigen
// Env-Zeilen aus. Voraussetzung: STRIPE_SECRET_KEY in .env.local ist der
// Live-Key (sk_live_...). Das Skript bricht bei einem Test-Key bewusst ab.
//
// Preise (Stand August 2026, abgestimmt):
//   Je Hochzeit  19 € einmalig
//   Pro          29 €/Monat, 249 €/Jahr
//   Team        149 €/Monat, 1488 €/Jahr
import Stripe from 'stripe';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const key = env.match(/^STRIPE_SECRET_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error('STRIPE_SECRET_KEY nicht gefunden');
if (!key.startsWith('sk_live_')) {
  throw new Error('STRIPE_SECRET_KEY ist kein Live-Key (sk_live_...). Erst den Live-Key aus dem Stripe-Dashboard in .env.local eintragen.');
}

const stripe = new Stripe(key);

// Schutz vor Doppel-Anlage bei erneutem Lauf: vorhandene Produkte
// gleichen Namens wiederverwenden.
async function ensureProduct(name, description) {
  const existing = await stripe.products.search({ query: `name:"${name}" AND active:"true"` });
  if (existing.data.length > 0) {
    console.error(`  Produkt "${name}" existiert schon, wird wiederverwendet (${existing.data[0].id})`);
    return existing.data[0];
  }
  return stripe.products.create({ name, description });
}

async function ensurePrice(product, opts, nickname) {
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const match = prices.data.find(
    (p) =>
      p.unit_amount === opts.unit_amount &&
      p.currency === 'eur' &&
      (p.recurring?.interval ?? null) === (opts.recurring?.interval ?? null)
  );
  if (match) {
    console.error(`  Preis "${nickname}" existiert schon, wird wiederverwendet (${match.id})`);
    return match;
  }
  return stripe.prices.create({ product: product.id, currency: 'eur', nickname, ...opts });
}

console.error('Lege Produkte an ...');
const eventPass = await ensureProduct(
  'BeatControl Je Hochzeit',
  'Einmalige Hochzeits-Wunschliste, 30 Tage vor bis 1 Tag nach der Feier gültig.'
);
const pro = await ensureProduct(
  'BeatControl Pro',
  'Für aktive Hochzeits-DJs: unbegrenzt Events, Branding, Export.'
);
const team = await ensureProduct(
  'BeatControl Team',
  'Whitelabel für DJ-Kollektive und Eventagenturen: eigene Zugänge für jeden DJ, eigene Subdomain, komplett eigenes Branding.'
);

console.error('Lege Preise an ...');
const pEventPass = await ensurePrice(eventPass, { unit_amount: 1900 }, 'Je Hochzeit 19');
const pProMonthly = await ensurePrice(pro, { unit_amount: 2900, recurring: { interval: 'month' } }, 'Pro monatlich 29');
const pProYearly = await ensurePrice(pro, { unit_amount: 24900, recurring: { interval: 'year' } }, 'Pro jaehrlich 249');
const pTeamMonthly = await ensurePrice(team, { unit_amount: 14900, recurring: { interval: 'month' } }, 'Team monatlich 149');
const pTeamYearly = await ensurePrice(team, { unit_amount: 148800, recurring: { interval: 'year' } }, 'Team jaehrlich 1488');

console.error('Lege Webhook-Endpoint an ...');
const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
let hook = hooks.data.find((h) => h.url === 'https://beatcontrol.io/api/stripe/webhook');
let hookSecretNote = '';
if (hook) {
  console.error(`  Webhook existiert schon (${hook.id}); das Secret zeigt Stripe nur bei der Anlage. Bei Bedarf im Dashboard neu ausrollen.`);
  hookSecretNote = '<vorhandenes Secret aus dem Stripe-Dashboard>';
} else {
  hook = await stripe.webhookEndpoints.create({
    url: 'https://beatcontrol.io/api/stripe/webhook',
    enabled_events: [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.payment_failed',
    ],
  });
  hookSecretNote = hook.secret;
}

console.log('STRIPE_PRICE_EVENT_PASS=' + pEventPass.id);
console.log('STRIPE_PRICE_PRO_MONTHLY=' + pProMonthly.id);
console.log('STRIPE_PRICE_PRO_YEARLY=' + pProYearly.id);
console.log('STRIPE_PRICE_STUDIO_MONTHLY=' + pTeamMonthly.id);
console.log('STRIPE_PRICE_STUDIO_YEARLY=' + pTeamYearly.id);

// Sicherheitsrelevant: Stripe zeigt das Webhook-Secret nur EINMAL bei der
// Anlage. Es wird direkt (und nur) in die gitignierte .env.local geschrieben —
// weder Terminal-Ausgabe noch Loss bei Neuanlage.
if (hook.secret) {
  const envPath = new URL('../.env.local', import.meta.url);
  let envContent = '';
  try {
    envContent = readFileSync(envPath, 'utf-8');
  } catch {}
  const line = `STRIPE_WEBHOOK_SECRET=${hook.secret}`;
  if (/^STRIPE_WEBHOOK_SECRET=/m.test(envContent)) {
    writeFileSync(envPath, envContent.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, line));
  } else {
    writeFileSync(envPath, envContent + (envContent.endsWith('\n') || !envContent ? '' : '\n') + line + '\n');
  }
  try {
    chmodSync(envPath, 0o600);
  } catch {}
  console.log('STRIPE_WEBHOOK_SECRET=*** in .env.local eingetragen');
} else {
  console.log('STRIPE_WEBHOOK_SECRET=<vorhandenes Secret aus dem Stripe-Dashboard — Endpoint existierte schon>');
}
