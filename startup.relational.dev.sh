#!/usr/bin/env bash
set -e

# Remove copied .env so Railway environment variables take precedence
rm -f .env

echo "▶ Running database migrations..."
node -e "
require('reflect-metadata');
const { AppDataSource } = require('./dist/database/data-source');
AppDataSource.initialize()
  .then(() => AppDataSource.runMigrations())
  .then(() => { console.log('✅ Migrations complete'); process.exit(0); })
  .catch((err) => { console.error('❌ Migration error:', err); process.exit(0); });
"

echo "▶ Running database seeds..."
node dist/database/seeds/relational/run-seed.js || echo "⚠️ Seed skipped or already initialized"

echo "▶ Starting NestJS server..."
exec node dist/main



