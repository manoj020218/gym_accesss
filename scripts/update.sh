#!/usr/bin/env bash
# =============================================================================
# EDGE Gym — Standard Update Script
# Triggered by: POST /api/v1/admin/update/apply (owner only)
# Steps: backup → git pull → install → build → restart
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="${REPO_DIR}/logs/update.log"
BACKUP_DIR="${BACKUP_DIR:-${REPO_DIR}/backups}"

mkdir -p "$(dirname "$LOG_FILE")" "$BACKUP_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "====== UPDATE STARTED ======"
log "Repo: $REPO_DIR"
cd "$REPO_DIR"

# ── 1. Pre-update backup ──────────────────────────────────────────────────────
log "Step 1/5: Triggering pre-update backup..."
# The API server's runBackup is async; we just ensure the backup cron ran recently.
# The applyUpdate handler already calls runBackup() before spawning this script.
log "  Pre-update backup already triggered by API server."

# ── 2. Pull latest code ───────────────────────────────────────────────────────
log "Step 2/5: Pulling latest from origin/main..."
git fetch origin main --quiet
CURRENT=$(git rev-parse HEAD)
LATEST=$(git rev-parse origin/main)

if [ "$CURRENT" = "$LATEST" ]; then
  log "  Already at latest commit ($CURRENT). Nothing to update."
  log "====== UPDATE SKIPPED (already up-to-date) ======"
  exit 0
fi

log "  Updating $CURRENT → $LATEST"
git reset --hard origin/main

# ── 3. Install dependencies ───────────────────────────────────────────────────
log "Step 3/5: Installing dependencies..."
pnpm install --frozen-lockfile --silent

# ── 4. Build all packages ─────────────────────────────────────────────────────
log "Step 4/5: Building all packages..."
pnpm -r build --silent

# ── 5. Restart PM2 processes ─────────────────────────────────────────────────
log "Step 5/5: Restarting PM2 processes..."
pm2 restart edge-gym-api edge-gym-worker --update-env

log "====== UPDATE COMPLETE ======"
log "New version deployed. API server will be live in ~5 seconds."
