'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';

interface Event {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  active: boolean;
}

interface Song {
  id: number;
  title: string;
  artist: string;
  deezer_id: string | null;
  album_art_url: string | null;
  created_at: string;
  played: boolean;
  vote_count: number;
  has_voted: boolean;
}

interface SearchResult {
  deezerId: string;
  title: string;
  artist: string;
  albumArt: string;
}

export default function GuestPage() {
  const { slug } = useParams<{ slug: string }>();

  const [event, setEvent] = useState<Event | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);

  // Search
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Manual mode
  const [manualMode, setManualMode] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualArtist, setManualArtist] = useState('');

  // Submit / vote
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [votingId, setVotingId] = useState<number | null>(null);

  const clientIdRef = useRef('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Init client ID
  useEffect(() => {
    let id = localStorage.getItem('dj-guest-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('dj-guest-id', id);
    }
    clientIdRef.current = id;
  }, []);

  function clientHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return { 'x-client-id': clientIdRef.current, ...extra };
  }

  // Load event info
  const loadEvent = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${slug}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (res.ok) {
        setEvent(await res.json());
      }
    } catch {
      // ignore
    }
  }, [slug]);

  // Fetch songs
  const fetchSongs = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${slug}/songs`, {
        headers: clientHeaders(),
      });
      if (res.ok) {
        setSongs(await res.json());
      }
    } catch {
      // keep existing
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    loadEvent();
  }, [loadEvent]);

  useEffect(() => {
    fetchSongs();
    const interval = setInterval(fetchSongs, 2500);
    return () => clearInterval(interval);
  }, [fetchSongs]);

  // Auto-dismiss flash message
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  // Click-outside closes dropdown
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Deezer search with 300ms debounce
  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (q.length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data);
          setShowDropdown(data.length > 0);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  // Submit a song
  async function submitSong({
    title,
    artist,
    deezerId,
    albumArt,
  }: {
    title: string;
    artist: string;
    deezerId?: string;
    albumArt?: string;
  }) {
    if (submitting) return;
    setSubmitting(true);

    try {
      const res = await fetch(`/api/events/${slug}/songs`, {
        method: 'POST',
        headers: clientHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title, artist, deezerId, albumArt }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage({ text: data.error ?? 'Ein Fehler ist aufgetreten.', ok: false });
        return;
      }

      // Reset UI
      setQuery('');
      setSearchResults([]);
      setShowDropdown(false);
      setManualMode(false);
      setManualTitle('');
      setManualArtist('');

      if (data.duplicate) {
        setMessage({ text: 'Song ist schon in der Liste — deine Stimme wurde gezählt! 👍', ok: true });
      } else {
        setMessage({ text: 'Song vorgeschlagen – du bist dabei! 🎵', ok: true });
      }

      fetchSongs();
    } catch {
      setMessage({ text: 'Verbindungsfehler. Bitte nochmal versuchen.', ok: false });
    } finally {
      setSubmitting(false);
    }
  }

  function handleSelectResult(result: SearchResult) {
    setShowDropdown(false);
    setQuery('');
    submitSong({
      title: result.title,
      artist: result.artist,
      deezerId: result.deezerId,
      albumArt: result.albumArt,
    });
  }

  async function handleVote(song: Song) {
    if (votingId !== null) return;
    setVotingId(song.id);

    // Optimistic update
    setSongs((prev) =>
      prev
        .map((s) =>
          s.id === song.id
            ? {
                ...s,
                vote_count: song.has_voted ? s.vote_count - 1 : s.vote_count + 1,
                has_voted: !song.has_voted,
              }
            : s
        )
        .sort(
          (a, b) =>
            Number(a.played) - Number(b.played) ||
            b.vote_count - a.vote_count
        )
    );

    await fetch(
      song.has_voted
        ? `/api/events/${slug}/songs/unvote`
        : `/api/events/${slug}/songs/vote`,
      {
        method: 'POST',
        headers: clientHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ songId: song.id }),
      }
    );

    setVotingId(null);
  }

  // ── Not found ──────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-gold text-5xl mb-4">♪</p>
          <h1 className="font-serif text-3xl font-semibold text-ink mb-2">
            Event nicht gefunden
          </h1>
          <p className="text-muted">Bitte überprüfe den Link.</p>
        </div>
      </div>
    );
  }

  const unplayed = songs.filter((s) => !s.played);
  const played = songs.filter((s) => s.played);

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <div className="text-center pt-10 pb-6 px-4">
        <p className="text-gold text-3xl mb-1">♪</p>
        <h1 className="font-serif text-4xl font-semibold text-ink">
          {event?.title ?? 'Musikwünsche'}
        </h1>
        {event?.subtitle && (
          <p className="text-muted mt-1 text-sm">{event.subtitle}</p>
        )}
      </div>

      {/* Flash message */}
      {message && (
        <div
          className={`mx-4 mb-4 rounded-2xl px-4 py-3 text-center text-sm font-medium animate-fade-up max-w-lg mx-auto ${
            message.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Input card */}
      <div className="px-4 max-w-lg mx-auto mb-8">
        <div className="bg-ivory rounded-3xl p-5 shadow-sm border border-champagne">
          {manualMode ? (
            /* Manual entry form */
            <div className="space-y-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-muted text-sm">Manuell eingeben</span>
                <button
                  type="button"
                  onClick={() => {
                    setManualMode(false);
                    setManualTitle('');
                    setManualArtist('');
                  }}
                  className="text-gold text-sm hover:underline"
                >
                  ← Suche
                </button>
              </div>
              <input
                type="text"
                placeholder="Songtitel"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                maxLength={200}
                className="w-full px-4 py-4 rounded-2xl border border-champagne bg-cream text-ink text-lg placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
              />
              <input
                type="text"
                placeholder="Künstler / Band"
                value={manualArtist}
                onChange={(e) => setManualArtist(e.target.value)}
                maxLength={200}
                className="w-full px-4 py-4 rounded-2xl border border-champagne bg-cream text-ink text-lg placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
              />
              <button
                type="button"
                disabled={submitting || !manualTitle.trim() || !manualArtist.trim()}
                onClick={() =>
                  submitSong({ title: manualTitle.trim(), artist: manualArtist.trim() })
                }
                className="w-full py-4 bg-gold text-cream rounded-2xl text-lg font-semibold tracking-wide hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {submitting ? 'Wird eingereicht…' : '♪  Vorschlagen'}
              </button>
            </div>
          ) : (
            /* Search mode */
            <div className="relative" ref={dropdownRef}>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Song suchen…"
                  value={query}
                  onChange={handleSearchChange}
                  onFocus={() => {
                    if (searchResults.length > 0) setShowDropdown(true);
                  }}
                  className="w-full px-4 py-4 rounded-2xl border border-champagne bg-cream text-ink text-lg placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors pr-10"
                />
                {searching && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <div className="w-4 h-4 border-2 border-gold border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
              </div>

              {/* Dropdown */}
              {showDropdown && searchResults.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-ivory border border-champagne rounded-2xl shadow-lg overflow-hidden">
                  {searchResults.map((result) => (
                    <button
                      key={result.deezerId}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSelectResult(result)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-cream transition-colors text-left"
                    >
                      {result.albumArt && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={result.albumArt}
                          alt={result.title}
                          width={40}
                          height={40}
                          className="rounded-lg shrink-0 object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-ink text-sm truncate">{result.title}</p>
                        <p className="text-muted text-xs truncate">{result.artist}</p>
                      </div>
                    </button>
                  ))}
                  <div className="border-t border-champagne px-4 py-2">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setShowDropdown(false);
                        setManualMode(true);
                      }}
                      className="text-muted text-xs hover:text-gold transition-colors"
                    >
                      Song nicht gefunden? Manuell eingeben →
                    </button>
                  </div>
                </div>
              )}

              {/* "Not found" hint when dropdown is closed and query has something */}
              {!showDropdown && query.length >= 2 && !searching && (
                <div className="mt-2 text-center">
                  <button
                    type="button"
                    onClick={() => setManualMode(true)}
                    className="text-muted text-sm hover:text-gold transition-colors"
                  >
                    Song nicht gefunden? Manuell eingeben →
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Song list */}
      <div className="px-4 max-w-lg mx-auto pb-16">
        {loading ? (
          <p className="text-center text-muted py-8">Lädt…</p>
        ) : songs.length === 0 ? (
          <p className="text-center text-muted py-8">Noch keine Vorschläge – sei der Erste! 🎶</p>
        ) : (
          <>
            <h2 className="font-serif text-xl text-ink text-center mb-4">
              Wunschliste
              {unplayed.length > 0 && (
                <span className="ml-2 text-gold text-base font-normal">
                  ({unplayed.length})
                </span>
              )}
            </h2>

            <div className="space-y-2">
              {unplayed.map((song, i) => (
                <SongCard
                  key={song.id}
                  song={song}
                  rank={i + 1}
                  onVote={handleVote}
                  voting={votingId === song.id}
                />
              ))}
            </div>

            {played.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 h-px bg-champagne" />
                  <span className="text-muted text-xs uppercase tracking-widest">
                    Gespielt
                  </span>
                  <div className="flex-1 h-px bg-champagne" />
                </div>
                <div className="space-y-2 opacity-40">
                  {played.map((song) => (
                    <SongCard
                      key={song.id}
                      song={song}
                      rank={null}
                      onVote={handleVote}
                      voting={false}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SongCard({
  song,
  rank,
  onVote,
  voting,
}: {
  song: Song;
  rank: number | null;
  onVote: (song: Song) => void;
  voting: boolean;
}) {
  return (
    <div className="bg-ivory rounded-2xl p-4 flex items-center gap-3 border border-champagne shadow-sm animate-fade-up">
      {song.album_art_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={song.album_art_url}
          alt={song.title}
          width={40}
          height={40}
          className="rounded-xl shrink-0 object-cover"
        />
      ) : rank !== null ? (
        <span className="font-serif text-champagne text-xl font-bold w-10 text-center shrink-0">
          {rank}
        </span>
      ) : null}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-ink text-base truncate">{song.title}</p>
        <p className="text-muted text-sm truncate">{song.artist}</p>
      </div>
      <button
        onClick={() => onVote(song)}
        disabled={voting || song.played}
        aria-label={song.has_voted ? 'Stimme entfernen' : 'Abstimmen'}
        className={`
          flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-semibold text-base min-w-[4.5rem]
          justify-center transition-all active:scale-90 shrink-0
          ${
            song.has_voted
              ? 'bg-gold text-cream shadow-sm'
              : 'bg-cream text-muted border border-champagne hover:border-gold hover:text-gold'
          }
          ${voting ? 'opacity-50 cursor-wait' : ''}
          ${song.played ? 'pointer-events-none' : ''}
        `}
      >
        {song.has_voted ? '♥' : '♡'}&nbsp;{song.vote_count}
      </button>
    </div>
  );
}
