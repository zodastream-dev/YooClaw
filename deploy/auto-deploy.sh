#!/bin/bash
# YooClaw Auto-Deploy Script
# Polls Gitee for new commits and redeploys if changes are detected.
# Place on server at /opt/YooClaw/deploy/auto-deploy.sh
# Run via cron: */2 * * * * /opt/YooClaw/deploy/auto-deploy.sh >> /opt/YooClaw/deploy/deploy.log 2>&1

set -e

PROJECT_DIR="/opt/YooClaw"
BRANCH="master"
LOCK_FILE="/tmp/yooclaw-deploy.lock"
LOG_FILE="$PROJECT_DIR/deploy/deploy.log"

# Prevent concurrent deploys
if [ -f "$LOCK_FILE" ]; then
  if kill -0 $(cat "$LOCK_FILE") 2>/dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Another deploy is running, skipping"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cleanup() {
  rm -f "$LOCK_FILE"
}
trap cleanup EXIT

cd "$PROJECT_DIR"

# Fetch latest from Gitee
log "Fetching from Gitee..."
git fetch origin "$BRANCH" --quiet

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [ "$LOCAL" = "$REMOTE" ]; then
  log "No changes detected ($LOCAL)"
  exit 0
fi

log "New commits found!"
log "  Local:  $LOCAL"
log "  Remote: $REMOTE"

# Pull changes
log "Pulling changes..."
git pull origin "$BRANCH" --ff-only

# Check if dependencies changed
if git diff --name-only "$LOCAL" "$REMOTE" | grep -q "package.json"; then
  log "package.json changed, running npm install..."
  npm install --ignore-scripts
fi

# Restart service (graceful reload for zero-downtime)
log "Reloading PM2..."
pm2 reload yooclaw --update-env

# Wait for health check
sleep 5
if curl -sf http://127.0.0.1:3001/api/health > /dev/null 2>&1; then
  log "Deploy successful! Health check passed."
else
  log "WARNING: Health check failed after deploy!"
fi
