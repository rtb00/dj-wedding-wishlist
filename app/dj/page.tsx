'use client';

import { useState, useEffect, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';

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
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [guestUrl, setGuestUrl] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setToken(saved);
    else setLoading(false);
  }, []);

  useEffect(() => {
    setGuestUrl(window.location.origin);
  }, []);

  const fetchSongs = useCallback(async () => {
    try {
      const res = await fetch('/api/songs');
      if (res.ok) {
        setSongs(await res.json());
      }
    } catch {
      // Network error – ignore
    } finally {
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

  async function handleDelete(songId: number, title: string) {
    if (!token || !confirm(`"${title}" wirklich löschen?`)) return;
    setDeletingId(songId);
    setSongs((prev) => prev.filter((s) => s.id !== songId));
    await fetch('/api/dj/delete-song', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-dj-token': token },
      body: JSON.stringify({ songId }),
    });
    setDeletingId(null);
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

  // ── DJ split-screen view ──────────────────────────────────────────────────
  const unplayed = songs.filter((s) => !s.played);
  const played = songs.filter((s) => s.played);

  return (
    <div className="h-screen flex flex-col bg-cream overflow-hidden">
      {/* Header */}
      <div className="shrink-0 bg-ivory border-b border-champagne px-6 py-3 flex items-center justify-between">
        <h1 className="font-serif text-xl font-semibold text-ink">DJ-Ansicht</h1>
        <div className="flex items-center gap-4">
          <span className="text-muted text-sm">
            {unplayed.length} offen · {played.length} gespielt
          </span>
          <span className="w-2 h-2 rounded-full bg-gold animate-pulse" title="Live" />
          <button
            onClick={handleLogout}
            className="text-muted text-sm hover:text-ink transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Split body */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left: QR panel ─────────────────────────────────────────────── */}
        <div className="w-72 xl:w-80 shrink-0 flex flex-col items-center justify-center gap-5 p-8">
          <div className="text-center">
            <p className="text-gold text-xl mb-1">♪</p>
            <h2 className="font-serif text-2xl font-semibold text-ink leading-tight">
              Musikwünsche
            </h2>
            <p className="text-muted text-sm mt-1">Scanne mich!</p>
          </div>

          {guestUrl ? (
            <div className="bg-white rounded-3xl p-4 border-2 border-champagne shadow-[0_4px_20px_rgba(201,169,97,0.18)]">
              <QRCodeSVG
                value={guestUrl}
                size={200}
                fgColor="#2a2520"
                bgColor="#ffffff"
                level="M"
              />
            </div>
          ) : (
            <div className="w-[232px] h-[232px] rounded-3xl bg-ivory border-2 border-champagne animate-pulse" />
          )}

          <p className="text-muted/60 text-xs text-center font-mono break-all leading-relaxed max-w-[220px]">
            {guestUrl}
          </p>
        </div>

        {/* ── Gold divider ────────────────────────────────────────────────── */}
        <div className="py-8 shrink-0 flex items-stretch">
          <div className="w-px bg-gold/30" />
        </div>

        {/* ── Right: Song list ─────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 xl:p-8 pb-16">
          {loading ? (
            <p className="text-center text-muted py-12">Lädt…</p>
          ) : unplayed.length === 0 && played.length === 0 ? (
            <p className="text-center text-muted py-12">Noch keine Vorschläge.</p>
          ) : (
            <>
              <div className="space-y-3">
                {unplayed.map((song, i) => (
                  <DJCard
                    key={song.id}
                    song={song}
                    rank={i + 1}
                    onToggle={handleToggle}
                    toggling={togglingId === song.id}
                    onDelete={handleDelete}
                    deleting={deletingId === song.id}
                  />
                ))}
              </div>

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
                        onDelete={handleDelete}
                        deleting={deletingId === song.id}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DJCard({
  song,
  rank,
  onToggle,
  toggling,
  onDelete,
  deleting,
}: {
  song: Song;
  rank: number | null;
  onToggle: (id: number) => void;
  toggling: boolean;
  onDelete: (id: number, title: string) => void;
  deleting: boolean;
}) {
  return (
    <div className="bg-ivory rounded-3xl p-4 flex items-center gap-3 border border-champagne shadow-sm">
      {rank !== null && (
        <span className="font-serif text-4xl font-bold text-champagne w-10 text-center shrink-0 tabular-nums">
          {rank}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-ink text-lg leading-tight truncate">
          {song.title}
        </p>
        <p className="text-muted text-sm truncate">{song.artist}</p>
        <p className="text-champagne text-xs mt-0.5">
          {new Date(song.created_at).toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-gold font-bold text-xl tabular-nums">
          ♥ {song.vote_count}
        </span>
        <button
          onClick={() => onToggle(song.id)}
          disabled={toggling || deleting}
          className={`
            px-4 py-2.5 rounded-2xl font-semibold text-sm transition-all active:scale-95
            ${
              song.played
                ? 'bg-cream text-muted border border-champagne hover:border-ink hover:text-ink'
                : 'bg-ink text-cream hover:opacity-90'
            }
            ${toggling ? 'opacity-50 cursor-wait' : ''}
          `}
        >
          {song.played ? '↩ Zurück' : '✓ Gespielt'}
        </button>
        <button
          onClick={() => onDelete(song.id, song.title)}
          disabled={deleting || toggling}
          aria-label="Song löschen"
          className="p-2.5 rounded-2xl text-muted border border-champagne hover:border-red-300 hover:text-red-500 hover:bg-red-50 transition-all active:scale-95 disabled:opacity-30"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.519.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}
