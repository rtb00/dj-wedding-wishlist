'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CalmScope, Card, Button } from '@/app/components/ui';

type Plan = 'pro_yearly' | 'pro_monthly' | 'event_pass' | 'couple_pass' | 'credit_pack_5';

function parsePlan(raw: string | null): Plan | null {
  if (raw === 'pro_yearly' || raw === 'pro_monthly' || raw === 'event_pass' || raw === 'couple_pass' || raw === 'credit_pack_5') return raw;
  return null;
}

const PLAN_LABEL: Record<Plan, string> = {
  pro_yearly: 'Pro · jährlich',
  pro_monthly: 'Pro · monatlich',
  event_pass: 'Je Event',
  couple_pass: 'Eure Feier · einmalig',
  credit_pack_5: '5er-Pack · 5 Events',
};

// Feier freischalten: ein DJ ohne Konto muss sich im Zuge des Kaufs
// registrieren. slug identifiziert die Feier, dj trägt das DJ-Token aus dem
// geteilten Link. Beides landet direkt im Checkout —
// dort gibt es für diesen Weg keinen Plan-Vergleich zu zeigen.
function parseSlug(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 && trimmed.length <= 80 ? trimmed : null;
}

/** Startet den Checkout für einen Abo-Tarif direkt, ohne Zwischenseite. */
async function startPlanCheckout(tier: string): Promise<boolean> {
  try {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      window.location.href = data.url;
      return true;
    }
  } catch {
    /* fällt unten auf die normale Weiterleitung zurück */
  }
  return false;
}

async function startCoupleCheckout(
  slug: string,
  unlockGift: boolean,
  onFail?: () => void
): Promise<boolean> {
  try {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'couple_pass', slug, unlock_gift: unlockGift }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      window.location.href = data.url;
      return true;
    }
    // Scheitern sichtbar machen — vorher landete der Nutzer stumm wieder auf
    // der Registrierungsseite (z.B. wenn die Feier inzwischen gelöscht wurde).
    onFail?.();
  } catch {
    onFail?.();
  }
  return false;
}

function RegisterPageInner() {
  const params = useSearchParams();
  const plan = parsePlan(params.get('plan'));
  const slug = parseSlug(params.get('slug'));
  const djToken = params.get('dj')?.trim() || null;
  // Kommt der DJ über den geteilten Live-Screen-Link zum Kauf, bekommt er
  // dafür ein Event-Guthaben geschenkt — der Kernanreiz für die Registrierung.
  const isGiftPurchase = !!slug && !!djToken;
  const signinHref = plan ? `/auth/signin?plan=${plan}` : '/auth/signin';

  const [email, setEmail] = useState('');
  // Kommt der Weg aus dem Brautpaar-Funnel, gehört das Konto einem Paar.
  const [isCouple, setIsCouple] = useState(false);
  // Scheiternder Auto-Checkout (Feier inzwischen gelöscht o.ä.) — muss sichtbar
  // sein, sonst wirkt die Seite wie ein stiller Loop.
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Eine Feier zum Freischalten führt direkt in ihren Checkout. Sonst führt
  // ein ausgewählter Plan zur Buchung, daran ändert das Paar-Merkmal nichts.
  // Ohne beides geht ein Paar zu seiner Feier, alle anderen in den DJ-Bereich.
  const postRegisterUrl = slug
    ? `/auth/register?slug=${encodeURIComponent(slug)}${djToken ? `&dj=${encodeURIComponent(djToken)}` : ''}`
    : plan
      ? '/dj'
      : isCouple
        ? '/feier'
        : '/dj';

  // Google-Login verlässt die Seite komplett und kehrt erst nach dem OAuth-
  // Roundtrip zurück. Ist dann eine Feier zum Freischalten in der URL und der
  // Nutzer eingeloggt, startet der Checkout automatisch statt einer weiteren
  // Zwischenseite.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => {
        if (cancelled || !me) return;
        startCoupleCheckout(slug, isGiftPurchase, () =>
          setCheckoutError(
            'Die Feier zum Freischalten konnte nicht gefunden werden. Bitte prüfe den Link oder wende dich an den Veranstalter.'
          )
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  // E-Mail aus dem Funnel (/start, /brautpaar/start) übernehmen, damit sie
  // niemand zweimal tippen muss. Das Feld bleibt editierbar.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const pending = localStorage.getItem('bc_pending_event');
      if (!pending) return;
      const data = JSON.parse(pending) as { email?: string; is_couple?: unknown };
      if (data.email) setEmail(data.email);
      if (data.is_couple === true) setIsCouple(true);
    } catch {
      /* defektes JSON ignorieren */
    }
  }, []);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acceptedAgb, setAcceptedAgb] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const consentGiven = acceptedAgb && acceptedPrivacy;

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    await signIn('google', { callbackUrl: postRegisterUrl });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!consentGiven) {
      setError('Bitte stimme den AGB und der Datenschutzerklärung zu.');
      return;
    }
    if (password.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen lang sein.');
      return;
    }
    if (password !== confirm) {
      setError('Passwörter stimmen nicht überein.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, is_couple: isCouple }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? 'Registrierung fehlgeschlagen.');
        setLoading(false);
        return;
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError('Registriert, aber Login fehlgeschlagen. Bitte manuell anmelden.');
        setLoading(false);
        return;
      }
      if (slug) {
        const started = await startCoupleCheckout(slug, isGiftPurchase, () =>
          setError(
            'Die Feier zum Freischalten konnte nicht gefunden werden. Bitte prüfe den Link oder wende dich an den Veranstalter.'
          )
        );
        if (started) return;
      } else if (plan) {
        // Wer mit Tarif-Vorwahl kommt, soll direkt zur Kasse und nicht über
        // eine Zwischenseite laufen.
        const started = await startPlanCheckout(plan);
        if (started) return;
      }
      window.location.href = postRegisterUrl;
    } catch {
      setError('Netzwerkfehler. Bitte erneut versuchen.');
      setLoading(false);
    }
  }

  return (
    <CalmScope className="min-h-screen bg-base flex flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="text-center text-turquoise text-3xl mb-3">♪</p>
        <h1 className="font-display text-3xl font-bold text-fg text-center mb-1">
          BeatControl
        </h1>
        <p className="text-fg-muted text-sm text-center mb-10">DJ-Account erstellen</p>

        {slug && (
          <div className="mb-6 rounded-2xl border border-neon-gold/40 bg-neon-gold/10 px-4 py-3 text-center">
            <p className="text-[10px] uppercase tracking-widest text-neon-gold font-semibold mb-1">
              Feier freischalten
            </p>
            <p className="text-sm text-fg font-semibold">
              Alle Songwünsche für 49 € einmalig sichtbar machen
            </p>
            <p className="text-xs text-fg-muted mt-1">
              {isGiftPurchase
                ? 'Nach dem Anlegen geht’s direkt zur Bezahlung. Als Dankeschön bekommst du ein Event geschenkt.'
                : 'Nach dem Anlegen geht’s direkt zur Bezahlung.'}
            </p>
          </div>
        )}
        {checkoutError && (
          <p className="mb-6 rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-center text-sm text-danger">
            {checkoutError}
          </p>
        )}
        {!slug && plan && (
          <div className="mb-6 rounded-2xl border border-turquoise/40 bg-turquoise/10 px-4 py-3 text-center">            <p className="text-[10px] uppercase tracking-widest text-turquoise font-semibold mb-1">
              Ausgewählter Plan
            </p>
            <p className="text-sm text-fg font-semibold">{PLAN_LABEL[plan]}</p>
            <p className="text-xs text-fg-muted mt-1">
              Nach dem Anlegen geht&apos;s direkt zur Buchung.
            </p>
          </div>
        )}

        <Card tone="calm" className="space-y-4">
          <Button
            type="button"
            tone="calm"
            variant="secondary"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || loading}
            className="w-full"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.332 35 24 35c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" fill="#FFC107"/>
              <path d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" fill="#FF3D00"/>
              <path d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.312 0-9.626-3.634-11.285-8.524l-6.522 5.025C9.505 39.556 16.227 44 24 44z" fill="#4CAF50"/>
              <path d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001.002-.001.003-.002l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" fill="#1976D2"/>
            </svg>
            {googleLoading ? 'Weiterleitung…' : 'Mit Google registrieren'}
          </Button>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <span className="text-xs text-fg-muted">oder</span>
            <div className="h-px flex-1 bg-line" />
          </div>

          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger-bg px-4 py-3 text-sm text-danger">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label htmlFor="email" className="block text-xs font-medium text-fg mb-1">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-line bg-panel text-fg placeholder:text-fg-muted focus:outline-none focus:border-turquoise transition-colors"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-medium text-fg mb-1">
                Passwort
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-line bg-panel text-fg placeholder:text-fg-muted focus:outline-none focus:border-turquoise transition-colors"
              />
              <p className="text-xs text-fg-muted mt-1">Mindestens 8 Zeichen</p>
            </div>
            <div>
              <label htmlFor="confirm" className="block text-xs font-medium text-fg mb-1">
                Passwort bestätigen
              </label>
              <input
                id="confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border border-line bg-panel text-fg placeholder:text-fg-muted focus:outline-none focus:border-turquoise transition-colors"
              />
            </div>
            <div className="space-y-2.5 pt-1">
              <label className="flex items-start gap-2.5 text-xs text-fg cursor-pointer leading-snug">
                <input
                  type="checkbox"
                  checked={acceptedAgb}
                  onChange={(e) => setAcceptedAgb(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-turquoise text-turquoise focus:ring-turquoise flex-shrink-0"
                />
                <span>
                  Ich stimme den{' '}
                  <Link href="/agb" target="_blank" className="text-turquoise hover:underline font-medium">
                    AGB
                  </Link>{' '}
                  zu.
                </span>
              </label>
              <label className="flex items-start gap-2.5 text-xs text-fg cursor-pointer leading-snug">
                <input
                  type="checkbox"
                  checked={acceptedPrivacy}
                  onChange={(e) => setAcceptedPrivacy(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-turquoise text-turquoise focus:ring-turquoise flex-shrink-0"
                />
                <span>
                  Ich habe die{' '}
                  <Link href="/datenschutz" target="_blank" className="text-turquoise hover:underline font-medium">
                    Datenschutzerklärung
                  </Link>{' '}
                  gelesen.
                </span>
              </label>
            </div>

            <Button
              type="submit"
              tone="calm"
              variant="primary"
              disabled={loading || !consentGiven}
              className="w-full"
            >
              {loading ? 'Registriere…' : 'Account erstellen'}
            </Button>
            <p className="text-xs text-fg-muted text-center">Kostenlos, keine Kreditkarte.</p>
          </form>
        </Card>

        <p className="text-center text-sm text-fg mt-6">
          Schon registriert?{' '}
          <Link href={signinHref} className="text-turquoise hover:underline font-medium">
            Anmelden
          </Link>
        </p>
      </div>
    </CalmScope>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-base" />}>
      <RegisterPageInner />
    </Suspense>
  );
}
