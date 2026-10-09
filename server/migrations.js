const fs = require('node:fs');
const path = require('node:path');

function applyMigrations(database, migrationsDirectory) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const applied = new Set(
    database.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name),
  );
  const files = fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith('.sql')).sort();

  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = fs.readFileSync(path.join(migrationsDirectory, name), 'utf8');
    database.exec('BEGIN IMMEDIATE;');
    try {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
}

module.exports = { applyMigrations };
