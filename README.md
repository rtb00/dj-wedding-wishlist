# dj-wedding-wishlist

Live-Musikwunschliste für Hochzeiten. Gäste scannen einen QR-Code, schlagen Songs vor und voten. Der DJ sieht die Liste live auf dem iPad.

## Views

- **`/`** — Gast-View: Song vorschlagen, für Songs voten
- **`/dj`** — DJ-View: Live-Liste sortiert nach Stimmen, Songs als "gespielt" markieren

## DJ-Passwort

`hochzeit2027` (direkt im Code, kein Env-Var nötig)

## Setup

### 1. Dependencies installieren

```bash
npm install
```

### 2. Datenbank einrichten

Das Projekt nutzt **Vercel Postgres** (Neon). Die Tabellen werden beim ersten API-Aufruf automatisch angelegt (`CREATE TABLE IF NOT EXISTS`).

**Lokal:** Erstelle eine `.env.local` und trage die Verbindungs-URL ein:

```bash
cp .env.example .env.local
# POSTGRES_URL=postgres://... eintragen
```

Lokale Postgres-Optionen:
- [Neon Free Tier](https://neon.tech) (empfohlen, funktioniert identisch zu Vercel Postgres)
- Lokale Postgres-Instanz via Docker

### 3. Lokal starten

```bash
npm run dev
```

→ [http://localhost:3000](http://localhost:3000)

## Deployment auf Vercel

### Vercel Postgres einrichten

1. In der [Vercel-Konsole](https://vercel.com/dashboard) → Storage → Create → Postgres
2. Datenbank mit dem Projekt verknüpfen → Vercel setzt `POSTGRES_URL` automatisch
3. Die Tabellen werden beim ersten Request automatisch erstellt

### Über die CLI deployen

```bash
vercel
vercel env pull .env.local   # Env-Vars für lokale Entwicklung holen
```

## Regeln

- Max. **3 Vorschläge** pro IP-Adresse
- **1 Stimme** pro Song pro IP-Adresse
- Wer einen Song vorschlägt, gibt automatisch die erste Stimme ab
- Doppelte Songs (gleicher Titel + Künstler) werden automatisch zusammengeführt
- Profanitätsfilter (Deutsch + Englisch) aktiv

## Tech Stack

- **Next.js 14** (App Router) + TypeScript
- **Vercel Postgres** (Neon) via `@vercel/postgres`
- **Tailwind CSS**
- Polling alle 2,5 s (Gast) / 3 s (DJ)
