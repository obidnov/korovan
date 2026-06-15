import Database from 'better-sqlite3'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Opened once; tests can substitute an in-memory instance via setDb().
let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialised — call openDb() first')
  return db
}

/** For tests: inject a pre-migrated in-memory DB. */
export function setDb(instance: Database.Database): void {
  db = instance
}

export function openDb(path: string = ':memory:'): Database.Database {
  db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

// ---------------------------------------------------------------------------
// Migration runner
// ---------------------------------------------------------------------------

function runMigrations(instance: Database.Database): void {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)

  const applied = new Set(
    (
      instance
        .prepare('SELECT version FROM schema_migrations')
        .all() as Array<{ version: string }>
    ).map((r) => r.version),
  )

  const migrationsDir = join(__dirname, '..', 'migrations')
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) continue
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    instance.exec(sql)
    instance
      .prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
      .run(file, Date.now())
  }
}
