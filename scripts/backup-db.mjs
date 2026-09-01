#!/usr/bin/env node
// scripts/backup-db.mjs
//
// Snapshot der BeatControl-Datenbank als JSON-Files.
// Zweck: Schnelles Sicherheitsnetz vor riskanten Migrationen oder Bulk-Deletes.
//
// Aufruf:
//   node scripts/backup-db.mjs                  # speichert nach ~/.beatcontrol-backups/YYYY-MM-DD-HHmmss/
//   node scripts/backup-db.mjs --out=mybackup   # custom Ordner (relativ zum Backup-Root)
//   BEATCONTROL_BACKUP_DIR=/pfad node scripts/backup-db.mjs
//
// Sicherheitsrelevant: Backups enthalten Klardaten (E-Mails, Namen, IPs).
// Standard-Ziel ist bewusst AUSSERHALB des Projektordners — ein Dump im Repo
// liegt einem `git add -f`, einem ZIP des Projektordners oder einem
// versehentlichen Entfernen der .gitignore-Zeile unmittelbar offen.
//
// Restore: kein Auto-Restore — bewusste manuelle Wiederherstellung, weil sonst
// versehentliche Restores in Production-Inkonsistenzen führen.

import { Client } from 'pg';
import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

try {
  const env = readFileSync('.env.local', 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const cs = process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED;
if (!cs) {
  console.error('❌ POSTGRES_URL_NON_POOLING fehlt in .env.local');
  process.exit(1);
}

const backupRoot = process.env.BEATCONTROL_BACKUP_DIR || path.join(os.homedir(), '.beatcontrol-backups');
const customOut = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1];
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.resolve(backupRoot, customOut ?? ts);
if (outDir.startsWith(process.cwd() + path.sep)) {
  console.warn('⚠️  Backup-Ziel liegt im Projektordner — verschiebe es nach außerhalb (Datenschutz).');
}
mkdirSync(outDir, { recursive: true });

const TABLES = [
  'users',
  'accounts',
  'sessions',
  'verification_tokens',
  'events',
  'songs',
  'votes',
  'waitlist',
  'analytics',
  'stripe_events',
];

const c = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();

console.log(`\n🗄  BeatControl DB-Backup → ${outDir}\n`);

const summary = {};

for (const table of TABLES) {
  try {
    const { rows } = await c.query(`SELECT * FROM ${table}`);
    const file = path.join(outDir, `${table}.json`);
    writeFileSync(file, JSON.stringify(rows, null, 2));
    summary[table] = rows.length;
    console.log(`  ✓ ${table}: ${rows.length} rows → ${path.relative(process.cwd(), file)}`);
  } catch (err) {
    summary[table] = `ERROR: ${err.message}`;
    console.log(`  ✗ ${table}: ${err.message}`);
  }
}

// Manifest mit Metadaten + Schema-Snapshot
const { rows: schemaRows } = await c.query(`
  SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`);

const manifest = {
  timestamp: new Date().toISOString(),
  rowCounts: summary,
  schema: schemaRows.reduce((acc, r) => {
    acc[r.table_name] = acc[r.table_name] ?? [];
    acc[r.table_name].push({
      column: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === 'YES',
      default: r.column_default,
    });
    return acc;
  }, {}),
};

writeFileSync(
  path.join(outDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2)
);

await c.end();

const totalRows = Object.values(summary)
  .filter((v) => typeof v === 'number')
  .reduce((a, b) => a + b, 0);

console.log(`\n✅ Backup komplett — ${totalRows} Rows in ${TABLES.length} Tabellen + manifest.json`);
console.log(`   Pfad: ${path.relative(process.cwd(), outDir)}\n`);
