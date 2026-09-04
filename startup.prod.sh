#!/bin/sh
# startup.prod.sh — Production startup (no wait-for-it, Neon is always online)
set -e

echo "▶ Running database migrations..."
node -e "
require('reflect-metadata');
const { AppDataSource } = require('./dist/database/data-source');
AppDataSource.initialize()
  .then(() => AppDataSource.runMigrations())
  .then(() => { console.log('✅ Migrations complete'); process.exit(0); })
  .catch((err) => { console.error('❌ Migration failed:', err); process.exit(1); });
"

echo "▶ Running database seeds..."
node dist/database/seeds/relational/run-seed.js || echo "⚠️ Seed skipped or encountered non-fatal error"

echo "▶ Starting NestJS server..."
exec node dist/main
