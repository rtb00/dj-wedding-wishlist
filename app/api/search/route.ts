import { NextRequest, NextResponse } from 'next/server';
import { isRateLimited } from '@/app/lib/rate-limit';
import { clientIp } from '@/app/lib/security';

interface DeezerTrack {
  id: number;
  title: string;
  title_short?: string;
  artist: { name: string };
  album: { cover_small: string };
}

interface CacheEntry {
  data: SearchResult[];
  ts: number;
}

interface SearchResult {
  deezerId: string;
  title: string;
  artist: string;
  albumArt: string;
}

const cache = new Map<string, CacheEntry>();
const TTL = 60_000;
const MAX_CACHE_ENTRIES = 200;
const MAX_QUERY_LENGTH = 120;

function pruneCache() {
  const now = Date.now();
  cache.forEach((entry, key) => {
    if (now - entry.ts >= TTL) cache.delete(key);
  });
  // Größenlimit: ohne Deckel füllt ein Angreifer die Map mit Einmal-Queries
  // bis zum OOM der Serverless-Instanz (Keys waren vorher unbegrenzt lang).
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export async function GET(req: NextRequest) {
  if (isRateLimited(`search:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const q = req.nextUrl.searchParams.get('q') ?? '';

  if (q.length < 2) {
    return NextResponse.json([]);
  }
  if (q.length > MAX_QUERY_LENGTH) {
    return NextResponse.json({ error: 'query too long' }, { status: 400 });
  }

  const cached = cache.get(q);
  if (cached && Date.now() - cached.ts < TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    const res = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`,
      { next: { revalidate: 0 } }
    );

    if (!res.ok) {
      return NextResponse.json([]);
    }

    const json = await res.json();
    const tracks: DeezerTrack[] = json.data ?? [];

    const data: SearchResult[] = tracks.map((track) => ({
      deezerId: String(track.id),
      title: track.title_short ?? track.title,
      artist: track.artist.name,
      albumArt: track.album.cover_small,
    }));

    pruneCache();
    cache.set(q, { data, ts: Date.now() });

    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
