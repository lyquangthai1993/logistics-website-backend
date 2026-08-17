#!/usr/bin/env bash
# startup.prod.sh — Production startup script for Oracle Cloud VM
# Runs DB migrations then starts the compiled NestJS server
set -e

echo "▶ Running database migrations..."
node -r tsconfig-paths/register ./node_modules/typeorm/cli.js \
  --dataSource=dist/database/data-source.js migration:run

echo "▶ Starting NestJS server..."
node dist/main
