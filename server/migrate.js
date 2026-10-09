const path = require('node:path');
const { loadConfig } = require('./config');
const { openDatabase } = require('./database');
const { applyMigrations } = require('./migrations');

const config = loadConfig();
const database = openDatabase(config.databasePath);
applyMigrations(database, path.join(config.projectRoot, 'db', 'migrations'));
database.close();
process.stdout.write('Test database migrations applied.\n');
