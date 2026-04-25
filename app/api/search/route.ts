import { NextRequest, NextResponse } from 'next/server';

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

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') ?? '';

  if (q.length < 2) {
    return NextResponse.json([]);
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

    cache.set(q, { data, ts: Date.now() });

    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
