#!/bin/bash
# test-vm-restart.sh — Start a Firecracker VM and diagnose boot issues
#
# Usage: ./scripts/dev/test-vm-restart.sh [VM_ID_OR_NAME]
# Default: bjj-roadmap

set -euo pipefail

API="http://localhost:4001/api"
TARGET="${1:-bjj-roadmap}"
POLL_INTERVAL=0.5
MAX_WAIT=20  # seconds

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[$(date +%H:%M:%S.%3N)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S.%3N)] ✓${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S.%3N)] ⚠${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S.%3N)] ✗${NC} $*"; }

# ── Resolve VM ──────────────────────────────────────────────────
log "Resolving VM: ${BOLD}${TARGET}${NC}"

VM_JSON=$(curl -sf "${API}/sandboxes" | jq -r --arg t "$TARGET" '
  .sandboxes[] | select(.id == $t or .name == $t) | @json
' | head -1)

if [ -z "$VM_JSON" ]; then
  err "VM '${TARGET}' not found"
  exit 1
fi

VM_ID=$(echo "$VM_JSON" | jq -r '.id')
VM_NAME=$(echo "$VM_JSON" | jq -r '.name')
VM_STATUS=$(echo "$VM_JSON" | jq -r '.status')
VM_BACKEND=$(echo "$VM_JSON" | jq -r '.backend')

ok "Found: ${BOLD}${VM_NAME}${NC} (${VM_ID}) — status=${VM_STATUS} backend=${VM_BACKEND}"

if [ "$VM_STATUS" = "running" ]; then
  ok "VM is already running, nothing to do"
  exit 0
fi

# ── Pre-flight checks ──────────────────────────────────────────
log "Pre-flight checks..."

# Check state.json
DATA_DIR="$(cd "$(dirname "$0")/../.." && pwd)/data"
STATE_FILE="${DATA_DIR}/firecracker-vms/${VM_ID}/state.json"
if [ -f "$STATE_FILE" ]; then
  STATE_STATUS=$(jq -r '.status' "$STATE_FILE")
  STATE_IP=$(jq -r '.guestIp // "none"' "$STATE_FILE")
  STATE_TAP=$(jq -r '.networkConfig.tapDevice // "none"' "$STATE_FILE")
  STATE_PID=$(jq -r '.pid // "none"' "$STATE_FILE")
  ok "state.json: status=${STATE_STATUS} ip=${STATE_IP} tap=${STATE_TAP} pid=${STATE_PID}"
else
  warn "No state.json at ${STATE_FILE}"
fi

# Check SSH keys
SSH_KEY="${DATA_DIR}/ssh-keys/id_ed25519"
if [ -f "$SSH_KEY" ]; then
  ok "SSH key exists: ${SSH_KEY}"
else
  err "SSH key missing: ${SSH_KEY}"
fi

# Check for stale firecracker processes
STALE_PROCS=$(ps aux | grep "[f]irecracker.*${VM_ID}" || true)
if [ -n "$STALE_PROCS" ]; then
  warn "Stale firecracker process found:"
  echo "$STALE_PROCS"
else
  ok "No stale firecracker processes"
fi

# Check for stale TAP device
if [ "$STATE_TAP" != "none" ] && [ -e "/sys/class/net/${STATE_TAP}" ]; then
  warn "Stale TAP device exists: ${STATE_TAP}"
else
  ok "No stale TAP device"
fi

# ── Start VM ────────────────────────────────────────────────────
echo ""
log "${BOLD}Starting VM ${VM_NAME}...${NC}"
START_TIME=$(date +%s%3N)

# Start in background, capture response
START_RESP=$(curl -sf -X POST "${API}/sandboxes/${VM_ID}/start" \
  -H "Content-Type: application/json" 2>&1) || {
  err "Start API call failed: ${START_RESP}"
  exit 1
}
ok "Start API returned: $(echo "$START_RESP" | jq -c '.' 2>/dev/null || echo "$START_RESP")"

# ── Poll for status ─────────────────────────────────────────────
echo ""
log "Polling status every ${POLL_INTERVAL}s (max ${MAX_WAIT}s)..."

LAST_STATUS=""
ELAPSED=0
while [ "$ELAPSED" -lt "$MAX_WAIT" ]; do
  POLL_JSON=$(curl -sf "${API}/sandboxes/${VM_ID}" 2>/dev/null || echo '{}')
  STATUS=$(echo "$POLL_JSON" | jq -r '.status // "unknown"')
  GUEST_IP=$(echo "$POLL_JSON" | jq -r '.guestIp // "none"')
  ERROR=$(echo "$POLL_JSON" | jq -r '.error // empty')

  NOW=$(date +%s%3N)
  ELAPSED_MS=$((NOW - START_TIME))
  ELAPSED=$((ELAPSED_MS / 1000))

  if [ "$STATUS" != "$LAST_STATUS" ]; then
    log "Status: ${BOLD}${STATUS}${NC}  ip=${GUEST_IP}  (${ELAPSED_MS}ms)"
    LAST_STATUS="$STATUS"
  fi

  case "$STATUS" in
    running)
      ok "VM is running! (${ELAPSED_MS}ms)"
      echo ""
      # ── Post-boot diagnostics ──────────────────────────────
      log "Running post-boot diagnostics..."

      # Try SSH
      if [ "$GUEST_IP" != "none" ] && [ -f "$SSH_KEY" ]; then
        log "Testing SSH to agent@${GUEST_IP}..."
        SSH_OUT=$(ssh -i "$SSH_KEY" \
          -o StrictHostKeyChecking=no \
          -o UserKnownHostsFile=/dev/null \
          -o ConnectTimeout=5 \
          -o IdentitiesOnly=yes \
          "agent@${GUEST_IP}" \
          'echo "SSH_OK"; hostname; uptime' 2>/dev/null) && {
          ok "SSH works:"
          echo "$SSH_OUT" | sed 's/^/    /'
        } || {
          warn "SSH failed to agent@${GUEST_IP}"
        }
      fi

      # Check state.json after boot
      if [ -f "$STATE_FILE" ]; then
        NEW_IP=$(jq -r '.guestIp // "none"' "$STATE_FILE")
        NEW_TAP=$(jq -r '.networkConfig.tapDevice // "none"' "$STATE_FILE")
        NEW_PID=$(jq -r '.pid // "none"' "$STATE_FILE")
        ok "Post-boot state: ip=${NEW_IP} tap=${NEW_TAP} pid=${NEW_PID}"
      fi

      exit 0
      ;;
    error)
      err "VM entered error state after ${ELAPSED_MS}ms"
      [ -n "$ERROR" ] && err "Error: ${ERROR}"

      # Dump state.json for debugging
      if [ -f "$STATE_FILE" ]; then
        echo ""
        log "Final state.json:"
        jq '.' "$STATE_FILE" | head -30
      fi

      # Check server logs for this VM
      echo ""
      log "Hint: check server console for [FirecrackerService] VM ${VM_ID} logs"
      exit 1
      ;;
    stopped)
      # Might briefly be stopped before transitioning
      ;;
  esac

  sleep "$POLL_INTERVAL"
done

err "Timeout after ${MAX_WAIT}s — VM stuck in '${LAST_STATUS}'"

# Dump final state
if [ -f "$STATE_FILE" ]; then
  echo ""
  log "Final state.json:"
  jq '.' "$STATE_FILE"
fi

exit 1
