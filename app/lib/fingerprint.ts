import { NextRequest } from 'next/server';

function getIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * Returns IP:clientId when a valid x-client-id header is present,
 * otherwise falls back to bare IP (e.g. localStorage disabled).
 */
export function getFingerprint(req: NextRequest): string {
  const ip = getIp(req);
  const clientId = req.headers.get('x-client-id')?.trim() ?? '';
  return clientId ? `${ip}:${clientId}` : ip;
}
