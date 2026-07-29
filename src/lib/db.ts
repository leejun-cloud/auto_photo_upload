import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import BetterSqlite3 from 'better-sqlite3';
import postgres from 'postgres';

// firestore takes priority: when DB_BACKEND=firestore, sqlite/postgres are ignored entirely.
const isFirestore = process.env.DB_BACKEND === 'firestore';
const isPostgres = !isFirestore && Boolean(process.env.DATABASE_URL);
const baseDataDir = process.env.VERCEL ? path.join(os.tmpdir(), 'stockflow-os') : path.join(process.cwd(), '.data');
export const dataDir = baseDataDir;
export const localUploadsDir = path.join(dataDir, 'uploads');
export const localExportsDir = path.join(dataDir, 'exports');

if (!isFirestore) {
  mkdirSync(localUploadsDir, { recursive: true });
  mkdirSync(localExportsDir, { recursive: true });
}

const sqliteDbPath = path.join(dataDir, 'stockflow.db');
const sqliteSchemaPath = path.join(process.cwd(), 'db', 'schema.sql');
const postgresSchemaPath = path.join(process.cwd(), 'db', 'postgres-schema.sql');

function bootstrapSqlite(db: BetterSqlite3.Database) {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(sqliteSchemaPath, 'utf8'));
}

let sqlite: BetterSqlite3.Database | null = null;
if (!isFirestore && !isPostgres) {
  sqlite = new BetterSqlite3(sqliteDbPath);
  try {
    bootstrapSqlite(sqlite);
  } catch (error) {
    sqlite.close();
    if (existsSync(sqliteDbPath)) unlinkSync(sqliteDbPath);
    if (existsSync(`${sqliteDbPath}-shm`)) unlinkSync(`${sqliteDbPath}-shm`);
    if (existsSync(`${sqliteDbPath}-wal`)) unlinkSync(`${sqliteDbPath}-wal`);
    sqlite = new BetterSqlite3(sqliteDbPath);
    bootstrapSqlite(sqlite);
  }
}

export const pg = isPostgres
  ? postgres(process.env.DATABASE_URL as string, {
      ssl: process.env.PGSSLMODE === 'disable' ? false : 'prefer',
      max: 5,
    })
  : null;

let initPromise: Promise<void> | null = null;

export function usingPostgres() {
  return isPostgres;
}

export function usingFirestore() {
  return isFirestore;
}

export function getSqlite() {
  if (!sqlite) throw new Error('SQLite is not active');
  return sqlite;
}

export function getPg() {
  if (!pg) throw new Error('PostgreSQL is not active');
  return pg;
}

export async function ensureDatabase() {
  if (isFirestore) return;
  if (!isPostgres) return;
  if (!initPromise) {
    initPromise = (async () => {
      const sql = getPg();
      const schema = readFileSync(postgresSchemaPath, 'utf8');
      await sql.unsafe(schema);
    })();
  }
  await initPromise;
}
