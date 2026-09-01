'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useBranding } from '@/app/lib/branding-context';
import { CalmScope, Card, Badge, NavBar, Button, buttonVariants } from '@/app/components/ui';

interface Me {
  id: string;
  name: string | null;
  email: string;
  plan: 'free' | 'pro' | 'event_pass' | 'studio';
  rawPlan: string;
  planStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
  brandingName: string | null;
  brandingLogoUrl: string | null;
  subdomain: string | null;
  hasPassword?: boolean;
  limits: {
    maxEvents: number | null;
    maxSongs: number | null;
    branding: boolean;
    export: boolean;
    maxSubAccounts: number | null;
    customDomain: boolean;
  };
}

function fmtDate(d: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export default function AccountPage() {
  const router = useRouter();
  const branding = useBranding();
  const brandName = branding.brandingName ?? 'BeatControl';

  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [brandingName, setBrandingName] = useState('');
  const [brandingLogoUrl, setBrandingLogoUrl] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [savingSubdomain, setSavingSubdomain] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [brandingMessage, setBrandingMessage] = useState<string | null>(null);
  const [subdomainMessage, setSubdomainMessage] = useState<string | null>(null);

  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteText, setDeleteText] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Me | null) => {
        if (!d) {
          router.push('/auth/signin?callbackUrl=/account');
          return;
        }
        setMe(d);
        setName(d.name ?? '');
        setBrandingName(d.brandingName ?? '');
        setBrandingLogoUrl(d.brandingLogoUrl ?? '');
        setSubdomain(d.subdomain ?? '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileMessage(null);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setProfileMessage(data.error ?? 'Speichern fehlgeschlagen.');
        return;
      }
      setProfileMessage('Gespeichert.');
      setMe((prev) => (prev ? { ...prev, name: name.trim() || null } : prev));
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveBranding(e: React.FormEvent) {
    e.preventDefault();
    setSavingBranding(true);
    setBrandingMessage(null);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandingName, brandingLogoUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBrandingMessage(data.error ?? 'Speichern fehlgeschlagen.');
        return;
      }
      setBrandingMessage('Gespeichert.');
      setMe((prev) =>
        prev
          ? {
              ...prev,
              brandingName: brandingName.trim() || null,
              brandingLogoUrl: brandingLogoUrl.trim() || null,
            }
          : prev
      );
    } finally {
      setSavingBranding(false);
    }
  }

  async function saveSubdomain(e: React.FormEvent) {
    e.preventDefault();
    setSavingSubdomain(true);
    setSubdomainMessage(null);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subdomain }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubdomainMessage(data.error ?? 'Speichern fehlgeschlagen.');
        return;
      }
      setSubdomainMessage('Subdomain gespeichert. DNS-Setup folgt nach Domain-Lock.');
      setMe((prev) => (prev ? { ...prev, subdomain: subdomain.trim().toLowerCase() || null } : prev));
    } finally {
      setSavingSubdomain(false);
    }
  }

  async function openPortal() {
    setPortalError(null);
    setPortalBusy(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        setPortalError(data.error ?? 'Portal konnte nicht geöffnet werden.');
        return;
      }
      window.location.href = data.url;
    } finally {
      setPortalBusy(false);
    }
  }

  async function handleDelete() {
    if (deleteText.trim().toUpperCase() !== 'LÖSCHEN') {
      setDeleteError('Bitte tippe LÖSCHEN ein, um zu bestätigen.');
      return;
    }
    // Konten mit Passwort verlangen die Passwortbestätigung — ein gestohlener
    // Session-Cookie allein reicht dann nicht mehr für die Löschung.
    if (me?.hasPassword && !deletePassword) {
      setDeleteError('Bitte gib dein Passwort ein, um die Löschung zu bestätigen.');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(me?.hasPassword ? { password: deletePassword } : {}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error ?? 'Konto konnte nicht gelöscht werden.');
        return;
      }
      await signOut({ callbackUrl: '/' });
    } catch {
      setDeleteError('Verbindungsfehler.');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <CalmScope className="min-h-screen bg-base flex items-center justify-center">
        <p className="text-fg-muted">Lädt…</p>
      </CalmScope>
    );
  }

  if (!me) return null;

  const isPro = me.plan === 'pro';
  const isStudio = me.plan === 'studio';
  const isEventPass = me.plan === 'event_pass';
  const status = me.planStatus;
  const cancelAtEnd = !!me.cancelAtPeriodEnd;
  const periodEnd = fmtDate(me.currentPeriodEnd);

  return (
    <CalmScope className="min-h-screen bg-base">
      <NavBar tone="calm">
        <Link href="/dj" className="text-sm text-fg-muted hover:text-fg transition-colors inline-flex items-center gap-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 01-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 010 10.75H10.75a.75.75 0 010-1.5h2.875a3.875 3.875 0 000-7.75H3.622l4.146 3.957a.75.75 0 01-1.036 1.085l-5.5-5.25a.75.75 0 010-1.085l5.5-5.25a.75.75 0 011.06.025z" clipRule="evenodd" />
          </svg>
          Zurück zum Dashboard
        </Link>
        {branding.brandingLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={branding.brandingLogoUrl} alt={brandName} className="h-7 w-auto object-contain" />
        ) : (
          <span className="font-display text-lg font-bold text-fg">{brandName}</span>
        )}
      </NavBar>

      <main className="max-w-3xl mx-auto px-4 py-10 pb-20 space-y-8">
        <header>
          <p className="text-turquoise text-xs font-semibold uppercase tracking-widest mb-2">Konto</p>
          <h1 className="font-display text-4xl font-bold text-fg">Einstellungen</h1>
        </header>

        {/* Plan banner — past_due */}
        {isPro && status === 'past_due' && (
          <div className="rounded-2xl border border-danger/40 bg-danger-bg px-5 py-4">
            <p className="font-semibold text-danger text-sm mb-1">Zahlung fehlgeschlagen</p>
            <p className="text-danger text-sm leading-relaxed">
              Deine letzte Zahlung konnte nicht abgebucht werden. Bitte aktualisiere deine
              Zahlungsmethode, sonst endet dein Pro-Plan in Kürze.
            </p>
            <Button
              onClick={openPortal}
              disabled={portalBusy}
              tone="calm"
              variant="danger"
              size="sm"
              className="mt-3"
            >
              {portalBusy ? 'Lädt…' : 'Zahlungsmethode aktualisieren'}
            </Button>
          </div>
        )}

        {/* Profile */}
        <Card tone="calm" className="p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold text-fg mb-1">Profil</h2>
          <p className="text-fg-muted text-sm mb-6">Wie wir dich in der App ansprechen.</p>

          <form onSubmit={saveProfile} className="space-y-5">
            <div>
              <label className="block text-xs text-fg-muted mb-1.5 px-1">E-Mail</label>
              <input
                type="email"
                value={me.email}
                disabled
                className="w-full px-4 py-3 rounded-2xl border border-line bg-base text-fg-muted cursor-not-allowed"
              />
              <p className="text-xs text-fg-muted/85 mt-1.5 px-1">
                Die E-Mail kann derzeit nicht geändert werden. Schreib uns, falls nötig.
              </p>
            </div>
            <div>
              <label className="block text-xs text-fg-muted mb-1.5 px-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dein Name"
                maxLength={100}
                className="w-full px-4 py-3 rounded-2xl border border-line bg-base text-fg placeholder:text-fg-muted/50 focus:outline-none focus:border-turquoise transition-colors"
              />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" tone="calm" variant="primary" size="sm" disabled={savingProfile}>
                {savingProfile ? 'Speichert…' : 'Speichern'}
              </Button>
              {profileMessage && (
                <span className="text-sm text-fg-muted">{profileMessage}</span>
              )}
            </div>
          </form>
        </Card>

        {/* Plan */}
        <Card tone="calm" className="p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold text-fg mb-1">Plan</h2>
          <p className="text-fg-muted text-sm mb-6">Dein aktuelles Abonnement.</p>

          {portalError && (
            <div className="mb-4 px-4 py-2.5 rounded-xl bg-danger-bg text-danger text-sm">
              {portalError}
            </div>
          )}

          {/* Free */}
          {me.plan === 'free' && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="font-semibold text-fg">Free Plan</p>
                <p className="text-fg-muted text-sm mt-1">
                  1 aktives Event · unbegrenzte Songwünsche · BeatControl-Branding.
                </p>
              </div>
              <Link
                href="/auth/register?plan=pro_yearly"
                className={buttonVariants({ tone: 'calm', variant: 'primary', size: 'sm', className: 'shrink-0 text-center' })}
              >
                Auf Pro upgraden
              </Link>
            </div>
          )}

          {/* Pro — active */}
          {isPro && !cancelAtEnd && status !== 'past_due' && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="font-semibold text-fg">Pro Plan</p>
                <p className="text-fg-muted text-sm mt-1">
                  {periodEnd
                    ? <>Verlängert sich am {periodEnd}.</>
                    : 'Aktiv.'}
                </p>
              </div>
              <Button
                onClick={openPortal}
                disabled={portalBusy}
                tone="calm"
                variant="secondary"
                size="sm"
                className="shrink-0"
              >
                {portalBusy ? 'Lädt…' : 'Plan verwalten'}
              </Button>
            </div>
          )}

          {/* Pro — cancel_at_period_end */}
          {isPro && cancelAtEnd && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-neon-gold/40 bg-neon-gold/10 px-4 py-3">
                <p className="text-fg text-sm font-medium">
                  Dein Pro-Plan endet {periodEnd ? `am ${periodEnd}` : 'am Ende der laufenden Periode'}.
                </p>
                <p className="text-fg-muted text-xs mt-1">
                  Bis dahin behältst du alle Pro-Funktionen.
                </p>
              </div>
              <Button
                onClick={openPortal}
                disabled={portalBusy}
                tone="calm"
                variant="primary"
                size="sm"
              >
                {portalBusy ? 'Lädt…' : 'Kündigung zurückziehen'}
              </Button>
            </div>
          )}

          {/* Pro — past_due (compact view, banner above already explains) */}
          {isPro && status === 'past_due' && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="font-semibold text-fg">Pro Plan</p>
                <p className="text-danger text-sm mt-1">Letzte Zahlung fehlgeschlagen.</p>
              </div>
              <Button
                onClick={openPortal}
                disabled={portalBusy}
                tone="calm"
                variant="primary"
                size="sm"
                className="shrink-0"
              >
                {portalBusy ? 'Lädt…' : 'Plan verwalten'}
              </Button>
            </div>
          )}

          {/* Event-Pass */}
          {isEventPass && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="font-semibold text-fg">Event-Pass</p>
                <p className="text-fg-muted text-sm mt-1">
                  {periodEnd ? <>Gültig bis {periodEnd}.</> : 'Gültig.'}
                </p>
              </div>
              <Button
                onClick={openPortal}
                disabled={portalBusy}
                tone="calm"
                variant="secondary"
                size="sm"
                className="shrink-0"
              >
                {portalBusy ? 'Lädt…' : 'Rechnung ansehen'}
              </Button>
            </div>
          )}

          {/* Team */}
          {isStudio && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <p className="font-semibold text-fg">Team Plan</p>
                <p className="text-fg-muted text-sm mt-1">
                  Whitelabel, Sub-Accounts und Custom-Domain freigeschaltet.
                  {periodEnd && <> Verlängert sich am {periodEnd}.</>}
                </p>
              </div>
              <Button
                onClick={openPortal}
                disabled={portalBusy}
                tone="calm"
                variant="secondary"
                size="sm"
                className="shrink-0"
              >
                {portalBusy ? 'Lädt…' : 'Plan verwalten'}
              </Button>
            </div>
          )}
        </Card>

        {/* Branding */}
        <Card tone="calm" className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h2 className="font-display text-xl font-semibold text-fg">Branding</h2>
            {!me.limits.branding && (
              <Badge color="gold" tone="calm">
                Pro
              </Badge>
            )}
          </div>
          <p className="text-fg-muted text-sm mb-6">
            Ersetze BeatControl in der Gäste-Ansicht durch deinen eigenen Namen und dein Logo.
          </p>

          <form onSubmit={saveBranding} className="space-y-5">
            <div>
              <label className="block text-xs text-fg-muted mb-1.5 px-1">Name</label>
              <input
                type="text"
                value={brandingName}
                onChange={(e) => setBrandingName(e.target.value)}
                placeholder="z.B. DJ Marcus"
                maxLength={80}
                disabled={!me.limits.branding}
                className="w-full px-4 py-3 rounded-2xl border border-line bg-base text-fg placeholder:text-fg-muted/50 focus:outline-none focus:border-turquoise transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs text-fg-muted mb-1.5 px-1">Logo-URL</label>
              <input
                type="url"
                value={brandingLogoUrl}
                onChange={(e) => setBrandingLogoUrl(e.target.value)}
                placeholder="https://…"
                maxLength={500}
                disabled={!me.limits.branding}
                className="w-full px-4 py-3 rounded-2xl border border-line bg-base text-fg placeholder:text-fg-muted/50 focus:outline-none focus:border-turquoise transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              />
              {brandingLogoUrl && /^https?:\/\//i.test(brandingLogoUrl) && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-xs text-fg-muted">Vorschau:</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={brandingLogoUrl}
                    alt="Logo Vorschau"
                    className="h-10 w-auto object-contain rounded border border-line bg-white p-1"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                type="submit"
                tone="calm"
                variant="primary"
                size="sm"
                disabled={savingBranding || !me.limits.branding}
              >
                {savingBranding ? 'Speichert…' : 'Speichern'}
              </Button>
              {brandingMessage && (
                <span className="text-sm text-fg-muted">{brandingMessage}</span>
              )}
              {!me.limits.branding && (
                <Link
                  href="/auth/register?plan=pro_yearly"
                  className="text-sm text-turquoise hover:underline"
                >
                  Auf Pro upgraden, um Branding zu nutzen →
                </Link>
              )}
            </div>
          </form>
        </Card>

        {/* Team: Subdomain & Whitelabel */}
        <Card tone="calm" className="p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h2 className="font-display text-xl font-semibold text-fg">Team: Eigene Subdomain</h2>
            {!isStudio && (
              <Badge color="gold" tone="calm">
                Team
              </Badge>
            )}
          </div>
          <p className="text-fg-muted text-sm mb-6">
            {isStudio
              ? 'Wähle deine eigene URL, z. B. deinakademie.beatcontrol.io. Custom-Domain auf Wunsch (per Mail anfragen).'
              : 'Team-Tarif gibt deinem Kollektiv oder deiner Agentur eine eigene Subdomain unter beatcontrol.io, komplettes Whitelabel-Branding und Sub-Accounts für deine DJs.'}
          </p>

          {isStudio ? (
            <form onSubmit={saveSubdomain} className="space-y-5">
              <div>
                <label className="block text-xs text-fg-muted mb-1.5 px-1">Subdomain</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={subdomain}
                    onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
                    placeholder="deinakademie"
                    maxLength={30}
                    pattern="[a-z0-9-]+"
                    className="flex-1 px-4 py-3 rounded-2xl border border-line bg-base text-fg placeholder:text-fg-muted/50 focus:outline-none focus:border-turquoise transition-colors font-mono text-sm"
                  />
                  <span className="text-fg-muted text-sm whitespace-nowrap">.beatcontrol.io</span>
                </div>
                <p className="text-xs text-fg-muted/85 mt-1.5 px-1">
                  3–30 Zeichen, nur a–z, 0–9 und Bindestrich. Wird live, sobald der DNS aktiv ist.
                </p>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Button
                  type="submit"
                  tone="calm"
                  variant="primary"
                  size="sm"
                  disabled={savingSubdomain}
                >
                  {savingSubdomain ? 'Speichert…' : 'Subdomain speichern'}
                </Button>
                {subdomainMessage && (
                  <span className="text-sm text-fg-muted">{subdomainMessage}</span>
                )}
              </div>
              {me.subdomain && (
                <div className="mt-2 px-4 py-3 rounded-2xl bg-base border border-line">
                  <p className="text-xs text-fg-muted mb-1">Deine URL (sobald DNS aktiv):</p>
                  <p className="font-mono text-sm text-fg">https://{me.subdomain}.beatcontrol.io</p>
                </div>
              )}
            </form>
          ) : (
            <Link
              href="mailto:nibor.bauer1+beatcontrol@gmail.com?subject=Team-Anfrage%20BeatControl"
              className={buttonVariants({ tone: 'calm', variant: 'primary', size: 'sm', className: 'inline-block' })}
            >
              Team anfragen
            </Link>
          )}
        </Card>

        {/* Sign out */}
        <Card tone="calm" className="p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold text-fg mb-1">Sitzung</h2>
          <p className="text-fg-muted text-sm mb-6">Auf diesem Gerät abmelden.</p>
          <Button
            onClick={() => signOut({ callbackUrl: '/' })}
            tone="calm"
            variant="secondary"
            size="sm"
          >
            Abmelden
          </Button>
        </Card>

        {/* Danger zone */}
        <Card tone="calm" className="border-danger/30 p-6 sm:p-8">
          <h2 className="font-display text-xl font-semibold text-fg mb-1">Konto löschen</h2>
          <p className="text-fg-muted text-sm mb-6">
            Löscht dein Konto, alle Events und alle gesammelten Songwünsche unwiderruflich.
            Ein laufendes Abonnement wird gleichzeitig bei Stripe gekündigt.
          </p>

          {!showDeleteConfirm ? (
            <Button
              onClick={() => setShowDeleteConfirm(true)}
              tone="calm"
              variant="danger"
              size="sm"
            >
              Konto löschen
            </Button>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-fg">
                Tippe <span className="font-mono font-bold">LÖSCHEN</span>, um zu bestätigen.
              </p>
              <input
                type="text"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder="LÖSCHEN"
                className="w-full px-4 py-3 rounded-2xl border border-danger/40 bg-base text-fg placeholder:text-fg-muted/50 focus:outline-none focus:border-danger transition-colors"
              />
              {me?.hasPassword && (
                <div>
                  <label htmlFor="delete-password" className="block text-sm text-fg mb-1.5">
                    Passwort bestätigen
                  </label>
                  <input
                    id="delete-password"
                    type="password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full px-4 py-3 rounded-2xl border border-danger/40 bg-base text-fg focus:outline-none focus:border-danger transition-colors"
                  />
                </div>
              )}
              {deleteError && (
                <p className="text-sm text-danger">{deleteError}</p>
              )}
              <div className="flex gap-3">
                <Button
                  onClick={handleDelete}
                  disabled={deleting}
                  tone="calm"
                  variant="danger"
                  size="sm"
                >
                  {deleting ? 'Lösche…' : 'Endgültig löschen'}
                </Button>
                <Button
                  onClick={() => {
                    setShowDeleteConfirm(false);
                    setDeleteText('');
                    setDeletePassword('');
                    setDeleteError(null);
                  }}
                  disabled={deleting}
                  tone="calm"
                  variant="secondary"
                  size="sm"
                >
                  Abbrechen
                </Button>
              </div>
            </div>
          )}
        </Card>
      </main>
    </CalmScope>
  );
}
