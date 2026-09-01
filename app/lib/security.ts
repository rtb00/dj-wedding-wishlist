import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

// Erlaubte Hosts für Client-gesendete Origins (Stripe success/cancel/return URLs).
// Alles andere fällt auf die serverseitige Request-URL zurück — dort ist der
// Host auf Vercel plattformseitig gepinnt und nicht client-manipulierbar.
const TRUSTED_HOST_SUFFIXES = ['beatcontrol.io', 'vercel.app'];
const DEV_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0'];

export function trustedOrigin(originHeader: string | null | undefined, requestUrl: string): string {
  if (originHeader) {
    try {
      const u = new URL(originHeader);
      const host = u.hostname.toLowerCase();
      const trusted =
        u.protocol === 'https:' &&
        (host === TRUSTED_HOST_SUFFIXES[0] || TRUSTED_HOST_SUFFIXES.some((s) => host.endsWith('.' + s)));
      if (trusted) return u.origin;
      if (u.protocol === 'http:' && DEV_HOSTS.includes(host)) return u.origin;
    } catch {
      // kaputter Origin-Header → Fallback unten
    }
  }
  return new URL(requestUrl).origin;
}

// Cover-URLs stammen aus der Deezer-Suche oder werden von Gästen frei
// mitgeschickt. Ohne Prüfung landet jede beliebige URL als <img src> auf
// Gästebildschirmen (Tracking-Pixel, anstößige Inhalte). Nur https und
// Deezer-CDN-Hosts sind erlaubt; alles andere wird verworfen.
const IMAGE_HOST_SUFFIXES = ['dzcdn.net', 'deezer.com'];

export function sanitizeImageUrl(raw: unknown, maxLength = 500): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > maxLength) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (!IMAGE_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith('.' + suffix))) {
      return null;
    }
    return u.toString();
  } catch {
    return null;
  }
}

// Gehashte Client-IP (mit demselben Pepper wie die Gästefingerprints): dient
// ausschließlich Tagesdeckeln gegen Ballot-Stuffing. Keine Klartext-IPs in der
// Datenbank — im SHA-256-Salat ist die ursprüngliche Adresse nicht wiederherstellbar.
export function clientIpHash(req: NextRequest): string {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
  const pepper = process.env.BEATCONTROL_HASH_PEPPER ?? 'dev-pepper-do-not-use-in-prod';
  return createHash('sha256').update(`${ip}|${pepper}`).digest('hex');
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? req.headers.get('x-real-ip') ?? 'unknown'
  );
}
