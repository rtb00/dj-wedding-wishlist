'use client';

import { useState, useEffect, useCallback } from 'react';

interface Song {
  id: number;
  title: string;
  artist: string;
  created_at: string;
  played: boolean;
  vote_count: number;
}

const STORAGE_KEY = 'dj-auth-token';

export default function DJPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setToken(saved);
    else setLoading(false);
  }, []);

  const fetchSongs = useCallback(async () => {
    const res = await fetch('/api/songs');
    if (res.ok) {
      setSongs(await res.json());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchSongs();
    const interval = setInterval(fetchSongs, 3000);
    return () => clearInterval(interval);
  }, [token, fetchSongs]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    const res = await fetch('/api/dj/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      localStorage.setItem(STORAGE_KEY, password);
      setToken(password);
    } else {
      setAuthError('Falsches Passwort.');
    }
  }

  async function handleToggle(songId: number) {
    if (togglingId !== null || !token) return;
    setTogglingId(songId);

    // Optimistic update
    setSongs((prev) =>
      prev.map((s) => (s.id === songId ? { ...s, played: !s.played } : s))
    );

    await fetch('/api/dj/toggle-played', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-dj-token': token },
      body: JSON.stringify({ songId }),
    });

    setTogglingId(null);
    fetchSongs();
  }

  function handleLogout() {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setPassword('');
    setSongs([]);
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!token) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <p className="text-gold text-3xl mb-2">♪</p>
            <h1 className="font-serif text-3xl font-semibold text-ink">DJ-Ansicht</h1>
          </div>
          <form
            onSubmit={handleLogin}
            className="bg-ivory rounded-3xl p-6 border border-champagne shadow-sm space-y-4"
          >
            <input
              type="password"
              placeholder="Passwort"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              className="w-full px-4 py-4 rounded-2xl border border-champagne bg-cream text-ink text-xl tracking-widest placeholder:tracking-normal placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
            />
            {authError && (
              <p className="text-red-600 text-sm text-center">{authError}</p>
            )}
            <button
              type="submit"
              className="w-full py-4 bg-ink text-cream rounded-2xl text-lg font-semibold hover:opacity-90 active:scale-95 transition-all"
            >
              Einloggen
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── DJ view ───────────────────────────────────────────────────────────────
  const unplayed = songs.filter((s) => !s.played);
  const played = songs.filter((s) => s.played);

  return (
    <div className="min-h-screen bg-cream">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-ivory border-b border-champagne px-6 py-4 flex items-center justify-between">
        <h1 className="font-serif text-2xl font-semibold text-ink">DJ-Ansicht</h1>
        <div className="flex items-center gap-4">
          <span className="text-muted text-sm">
            {unplayed.length} offen · {played.length} gespielt
          </span>
          <span
            className="w-2.5 h-2.5 rounded-full bg-gold animate-pulse"
            title="Live"
          />
          <button
            onClick={handleLogout}
            className="text-muted text-sm hover:text-ink transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 lg:p-8 max-w-3xl mx-auto pb-16">
        {loading ? (
          <p className="text-center text-muted py-12">Lädt…</p>
        ) : unplayed.length === 0 && played.length === 0 ? (
          <p className="text-center text-muted py-12">Noch keine Vorschläge.</p>
        ) : (
          <>
            {/* Unplayed */}
            <div className="space-y-3">
              {unplayed.map((song, i) => (
                <DJCard
                  key={song.id}
                  song={song}
                  rank={i + 1}
                  onToggle={handleToggle}
                  toggling={togglingId === song.id}
                />
              ))}
            </div>

            {/* Played separator */}
            {played.length > 0 && (
              <div className="mt-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex-1 h-px bg-champagne" />
                  <span className="text-muted text-xs uppercase tracking-widest">
                    Gespielt
                  </span>
                  <div className="flex-1 h-px bg-champagne" />
                </div>
                <div className="space-y-3 opacity-50">
                  {played.map((song) => (
                    <DJCard
                      key={song.id}
                      song={song}
                      rank={null}
                      onToggle={handleToggle}
                      toggling={togglingId === song.id}
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

function DJCard({
  song,
  rank,
  onToggle,
  toggling,
}: {
  song: Song;
  rank: number | null;
  onToggle: (id: number) => void;
  toggling: boolean;
}) {
  return (
    <div className="bg-ivory rounded-3xl p-5 flex items-center gap-4 border border-champagne shadow-sm">
      {rank !== null && (
        <span className="font-serif text-5xl font-bold text-champagne w-14 text-center shrink-0 tabular-nums">
          {rank}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-ink text-xl leading-tight truncate">
          {song.title}
        </p>
        <p className="text-muted text-base truncate">{song.artist}</p>
        <p className="text-champagne text-sm mt-1">
          {new Date(song.created_at).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <span className="text-gold font-bold text-2xl tabular-nums">
          ♥ {song.vote_count}
        </span>
        <button
          onClick={() => onToggle(song.id)}
          disabled={toggling}
          className={`
            px-5 py-3 rounded-2xl font-semibold text-base transition-all active:scale-95
            ${
              song.played
                ? 'bg-cream text-muted border border-champagne hover:border-ink hover:text-ink'
                : 'bg-ink text-cream hover:opacity-90'
            }
            ${toggling ? 'opacity-50 cursor-wait' : ''}
          `}
        >
          {song.played ? '↩ Zurück' : '✓  Gespielt'}
        </button>
      </div>
    </div>
  );
}
