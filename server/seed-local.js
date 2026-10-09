const path = require('node:path');
const { createOwner } = require('./auth');
const { loadConfig } = require('./config');
const { openDatabase } = require('./database');
const { applyMigrations } = require('./migrations');
const { seedServices } = require('./seed-data');

const email = process.env.ADMIN_OWNER_EMAIL;
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
if (!email || !password) throw new Error('ADMIN_OWNER_EMAIL and ADMIN_BOOTSTRAP_PASSWORD are required for test seeding.');

const config = loadConfig();
const database = openDatabase(config.databasePath);
applyMigrations(database, path.join(config.projectRoot, 'db', 'migrations'));
seedServices(database);
createOwner(database, email, password);
database.close();
process.stdout.write('Test owner and fixed services seeded. No credentials were printed.\n');
