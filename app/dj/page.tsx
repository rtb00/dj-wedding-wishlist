'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Event {
  id: number;
  slug: string;
  title: string;
  subtitle: string | null;
  active: boolean;
  created_at: string;
  song_count: number;
}

function generateSlug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function DJDashboard() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  // Create form
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formSubtitle, setFormSubtitle] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formPassword, setFormPassword] = useState('hochzeit2027');

  // Edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState<{ title: string; subtitle: string }>({
    title: '',
    subtitle: '',
  });

  useEffect(() => {
    loadEvents();
  }, []);

  async function loadEvents() {
    setLoading(true);
    try {
      const res = await fetch('/api/events');
      if (res.ok) {
        setEvents(await res.json());
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');

    if (!formTitle.trim()) {
      setFormError('Titel ist erforderlich.');
      return;
    }
    const slug = formSlug || generateSlug(formTitle);
    if (!slug || !/^[a-z0-9][a-z0-9-]{1,}$/.test(slug)) {
      setFormError('Slug muss mind. 2 Zeichen lang sein und nur a-z, 0-9 und - enthalten.');
      return;
    }

    setCreating(true);
    try {
      const res = await fetch('/api/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle.trim(),
          subtitle: formSubtitle.trim() || undefined,
          slug,
          djPassword: formPassword.trim() || 'hochzeit2027',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error ?? 'Fehler beim Erstellen.');
        return;
      }
      // Reset
      setFormTitle('');
      setFormSubtitle('');
      setFormSlug('');
      setFormPassword('hochzeit2027');
      setShowForm(false);
      loadEvents();
    } catch {
      setFormError('Verbindungsfehler.');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(event: Event) {
    await fetch(`/api/events/${event.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !event.active }),
    });
    loadEvents();
  }

  async function handleEdit(event: Event, data: { title: string; subtitle: string }) {
    await fetch(`/api/events/${event.slug}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: data.title, subtitle: data.subtitle || null }),
    });
    setEditingId(null);
    loadEvents();
  }

  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <div className="text-center pt-10 pb-6 px-4">
        <p className="text-gold text-3xl mb-1">♪</p>
        <h1 className="font-serif text-4xl font-semibold text-ink">DJ-Dashboard</h1>
        <p className="text-muted mt-1 text-sm">Events verwalten</p>
      </div>

      <div className="px-4 max-w-2xl mx-auto pb-16">
        {/* Create button */}
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="px-5 py-2.5 bg-gold text-cream rounded-2xl font-semibold hover:opacity-90 active:scale-95 transition-all"
          >
            + Neues Event erstellen
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <form
            onSubmit={handleCreate}
            className="mb-6 bg-ivory rounded-3xl p-5 border border-champagne shadow-sm space-y-3 animate-fade-up"
          >
            <input
              type="text"
              placeholder="Titel *"
              value={formTitle}
              onChange={(e) => {
                setFormTitle(e.target.value);
                if (!formSlug) setFormSlug(generateSlug(e.target.value));
              }}
              className="w-full px-4 py-3 rounded-2xl border border-champagne bg-cream text-ink placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
            />
            <input
              type="text"
              placeholder="Untertitel (optional)"
              value={formSubtitle}
              onChange={(e) => setFormSubtitle(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-champagne bg-cream text-ink placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
            />
            <div className="flex items-center gap-2">
              <span className="text-muted font-mono text-sm shrink-0">/</span>
              <input
                type="text"
                placeholder="slug"
                value={formSlug}
                onChange={(e) =>
                  setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                }
                className="flex-1 px-4 py-3 rounded-2xl border border-champagne bg-cream text-ink font-mono placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
              />
            </div>
            <input
              type="text"
              placeholder="DJ-Passwort"
              value={formPassword}
              onChange={(e) => setFormPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl border border-champagne bg-cream text-ink placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
            />
            {formError && (
              <p className="text-red-600 text-sm text-center">{formError}</p>
            )}
            <button
              type="submit"
              disabled={creating}
              className="w-full py-3 bg-ink text-cream rounded-2xl font-semibold hover:opacity-90 active:scale-95 disabled:opacity-50 transition-all"
            >
              {creating ? 'Erstelle…' : 'Event erstellen'}
            </button>
          </form>
        )}

        {/* Event list */}
        {loading ? (
          <p className="text-center text-muted py-12">Lädt…</p>
        ) : events.length === 0 ? (
          <p className="text-center text-muted py-12">Noch keine Events. Erstelle dein erstes!</p>
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <div
                key={event.id}
                className={`bg-ivory rounded-3xl p-5 border border-champagne shadow-sm transition-opacity ${
                  event.active ? '' : 'opacity-50'
                }`}
              >
                {editingId === event.id ? (
                  /* Inline edit form */
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={editData.title}
                      onChange={(e) => setEditData((d) => ({ ...d, title: e.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl border border-champagne bg-cream text-ink focus:outline-none focus:border-gold transition-colors"
                    />
                    <input
                      type="text"
                      placeholder="Untertitel (optional)"
                      value={editData.subtitle}
                      onChange={(e) => setEditData((d) => ({ ...d, subtitle: e.target.value }))}
                      className="w-full px-4 py-3 rounded-2xl border border-champagne bg-cream text-ink placeholder:text-muted/50 focus:outline-none focus:border-gold transition-colors"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(event, editData)}
                        className="px-4 py-2 bg-ink text-cream rounded-xl text-sm font-semibold hover:opacity-90 active:scale-95 transition-all"
                      >
                        Speichern
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="px-4 py-2 bg-cream text-muted rounded-xl text-sm border border-champagne hover:border-ink hover:text-ink transition-all"
                      >
                        Abbrechen
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Normal card */
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="min-w-0">
                        <h2 className="font-serif text-xl font-semibold text-ink truncate">
                          {event.title}
                        </h2>
                        {event.subtitle && (
                          <p className="text-muted text-sm truncate">{event.subtitle}</p>
                        )}
                        <p className="text-muted/60 text-xs font-mono mt-0.5">/{event.slug}</p>
                        <p className="text-muted text-xs mt-0.5">{event.song_count} Songs</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleToggleActive(event)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all active:scale-95 ${
                            event.active
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                              : 'bg-cream text-muted border border-champagne hover:border-ink hover:text-ink'
                          }`}
                        >
                          {event.active ? 'Aktiv' : 'Inaktiv'}
                        </button>
                        <button
                          onClick={() => {
                            setEditingId(event.id);
                            setEditData({
                              title: event.title,
                              subtitle: event.subtitle ?? '',
                            });
                          }}
                          className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-cream text-muted border border-champagne hover:border-ink hover:text-ink transition-all active:scale-95"
                        >
                          Bearbeiten
                        </button>
                      </div>
                    </div>
                    <Link
                      href={`/dj/${event.slug}`}
                      className="inline-block mt-2 text-gold text-sm font-medium hover:underline"
                    >
                      DJ-View →
                    </Link>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
