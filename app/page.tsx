'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface Song {
  id: number;
  title: string;
  artist: string;
  created_at: string;
  played: boolean;
  vote_count: number;
  has_voted: boolean;
}

export default function GuestPage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [votingId, setVotingId] = useState<number | null>(null);

  // Stable ref – avoids re-creating fetchSongs / restarting the poll interval
  const clientIdRef = useRef('');

  useEffect(() => {
    let id = localStorage.getItem('dj-guest-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('dj-guest-id', id);
    }
    clientIdRef.current = id;
  }, []);

  const clientHeaders = useCallback(
    (extra: Record<string, string> = {}): Record<string, string> => ({
      'x-client-id': clientIdRef.current,
      ...extra,
    }),
    []
  );

  const fetchSongs = useCallback(async () => {
    try {
      const res = await fetch('/api/songs', { headers: clientHeaders() });
      if (res.ok) {
        setSongs(await res.json());
      }
    } catch {
      // Network error – keep existing songs
    } finally {
      setLoading(false);
    }
  }, [clientHeaders]);

  useEffect(() => {
    fetchSongs();
    const interval = setInterval(fetchSongs, 2500);
    return () => clearInterval(interval);
  }, [fetchSongs]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !artist.trim() || submitting) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/songs', {
        method: 'POST',
        headers: clientHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ title: title.trim(), artist: artist.trim() }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage({ text: data.error ?? 'Ein Fehler ist aufgetreten. Bitte nochmal versuchen.', ok: false });
        return;
      }

      setTitle('');
      setArtist('');
      if (data.duplicate) {
        setMessage({ text: 'Dieser Song ist schon da – deine Stimme wurde gezählt! 👍', ok: true });
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

  async function handleVote(song: Song) {
    if (votingId !== null) return;
    setVotingId(song.id);

    // Optimistic update + re-sort
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
            Number(a.played) - Number(b.played) || b.vote_count - a.vote_count
        )
    );

    await fetch(song.has_voted ? '/api/songs/unvote' : '/api/songs/vote', {
      method: 'POST',
      headers: clientHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ songId: song.id }),
    });

    setVotingId(null);
  }

  const unplayed = songs.filter((s) => !s.played);
  const played = songs.filter((s) => s.played);

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <div className="text-center pt-10 pb-6 px-4">
        <p className="text-gold text-3xl mb-1">♪</p>
        <h1 className="font-serif text-4xl font-semibold text-ink">Musikwünsche</h1>
        <p className="text-muted mt-1 text-sm">Schlag deinen Lieblingssong vor!</p>
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

      {/* Form */}
      <div className="px-4 max-w-lg mx-auto mb-8">
        <form
          onSubmit={handleSubmit}
          className="bg-ivory rounded-3xl p-5 shadow-sm border border-champagne space-y-3"
        >
          <input
            type="text"
            placeholder="Songtitel"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            className="w-full px-4 py-4 rounded-2xl border border-champagne bg-cream text-ink text-lg placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
          />
          <input
            type="text"
            placeholder="Künstler / Band"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            maxLength={200}
            className="w-full px-4 py-4 rounded-2xl border border-champagne bg-cream text-ink text-lg placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
          />
          <button
            type="submit"
            disabled={submitting || !title.trim() || !artist.trim()}
            className="w-full py-4 bg-gold text-cream rounded-2xl text-lg font-semibold tracking-wide hover:opacity-90 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? 'Wird eingereicht…' : '♪  Vorschlagen'}
          </button>
        </form>
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
                <span className="ml-2 text-gold text-base font-normal">({unplayed.length})</span>
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
                  <span className="text-muted text-xs uppercase tracking-widest">Gespielt</span>
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
      {rank !== null && (
        <span className="font-serif text-champagne text-xl font-bold w-7 text-center shrink-0">
          {rank}
        </span>
      )}
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
