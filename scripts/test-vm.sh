#!/bin/bash
# Test script for Firecracker VM creation and SSH connectivity
#
# Usage: ./scripts/test-vm.sh [options]
#
# Options:
#   --api-url URL    API base URL (default: http://localhost:3001/api)
#   --vm-name NAME   VM name (default: test-vm-$$)
#   --keep           Don't delete VM after test
#   --timeout SEC    SSH timeout in seconds (default: 120)
#   -v, --verbose    Verbose output
#   -h, --help       Show this help

set -e

# Configuration
API_URL="${API_URL:-http://localhost:3001/api}"
VM_NAME="test-vm-$$"
KEEP_VM=false
SSH_TIMEOUT=120
VERBOSE=false

# Handle sudo: use SUDO_USER's home if running as root via sudo
if [ -n "$SUDO_USER" ]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    REAL_HOME="$HOME"
fi
SSH_KEY="$REAL_HOME/.local/share/handler/ssh-keys/id_ed25519"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()     { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*"; }
info()    { echo -e "${BLUE}[→]${NC} $*"; }
verbose() { [ "$VERBOSE" = true ] && echo -e "${BLUE}[DEBUG]${NC} $*" || true; }

cleanup() {
    if [ -n "$VM_ID" ] && [ "$KEEP_VM" = false ]; then
        info "Cleaning up VM $VM_ID..."
        curl -s -X DELETE "$API_URL/vms/$VM_ID" > /dev/null 2>&1 || true
    fi
}

trap cleanup EXIT

usage() {
    echo "Test Firecracker VM creation and SSH connectivity"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --api-url URL    API base URL (default: http://localhost:3001/api)"
    echo "  --vm-name NAME   VM name (default: test-vm-\$\$)"
    echo "  --keep           Don't delete VM after test"
    echo "  --timeout SEC    SSH timeout in seconds (default: 120)"
    echo "  -v, --verbose    Verbose output"
    echo "  -h, --help       Show this help"
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --api-url)
            API_URL="$2"
            shift 2
            ;;
        --vm-name)
            VM_NAME="$2"
            shift 2
            ;;
        --keep)
            KEEP_VM=true
            shift
            ;;
        --timeout)
            SSH_TIMEOUT="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "============================================"
echo "  Handler VM Test"
echo "============================================"
echo ""
echo "API URL:     $API_URL"
echo "VM Name:     $VM_NAME"
echo "SSH Key:     $SSH_KEY"
echo "SSH Timeout: ${SSH_TIMEOUT}s"
echo ""

# Check prerequisites
info "Checking prerequisites..."

if ! command -v curl &> /dev/null; then
    error "curl is required"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    error "jq is required"
    exit 1
fi

if [ ! -f "$SSH_KEY" ]; then
    error "SSH key not found: $SSH_KEY"
    exit 1
fi

# Check API is reachable
if ! curl -s "$API_URL/config" > /dev/null 2>&1; then
    error "API not reachable at $API_URL"
    error "Make sure the server is running: cd packages/server && pnpm dev"
    exit 1
fi
log "API is reachable"

# Step 1: Create VM
info "Creating VM '$VM_NAME'..."
CREATE_RESPONSE=$(curl -s -X POST "$API_URL/vms" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"$VM_NAME\", \"hypervisor\": \"firecracker\"}")

verbose "Create response: $CREATE_RESPONSE"

VM_ID=$(echo "$CREATE_RESPONSE" | jq -r '.id // empty')
if [ -z "$VM_ID" ]; then
    error "Failed to create VM"
    echo "$CREATE_RESPONSE" | jq .
    exit 1
fi
log "VM created: $VM_ID"

# Step 2: Wait for VM to be running
info "Waiting for VM to start..."
START_TIME=$(date +%s)
while true; do
    VM_STATUS=$(curl -s "$API_URL/vms/$VM_ID" | jq -r '.status // "unknown"')
    verbose "VM status: $VM_STATUS"

    case "$VM_STATUS" in
        running)
            log "VM is running"
            break
            ;;
        error)
            error "VM failed to start"
            curl -s "$API_URL/vms/$VM_ID" | jq .
            exit 1
            ;;
        creating|booting)
            ELAPSED=$(($(date +%s) - START_TIME))
            if [ $ELAPSED -gt $SSH_TIMEOUT ]; then
                error "Timeout waiting for VM to start"
                exit 1
            fi
            sleep 2
            ;;
        *)
            warn "Unknown status: $VM_STATUS"
            sleep 2
            ;;
    esac
done

# Step 3: Get VM info
VM_INFO=$(curl -s "$API_URL/vms/$VM_ID")
GUEST_IP=$(echo "$VM_INFO" | jq -r '.guestIp // empty')
SSH_PORT=$(echo "$VM_INFO" | jq -r '.sshPort // 22')
SSH_HOST=$(echo "$VM_INFO" | jq -r '.sshHost // empty')
SSH_USER=$(echo "$VM_INFO" | jq -r '.sshUser // "agent"')

if [ -n "$GUEST_IP" ]; then
    SSH_TARGET="$SSH_USER@$GUEST_IP"
    SSH_PORT=22
else
    SSH_TARGET="$SSH_USER@${SSH_HOST:-127.0.0.1}"
fi

info "SSH target: $SSH_TARGET (port $SSH_PORT)"

# Step 4: Test SSH connectivity
info "Testing SSH connectivity..."
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o BatchMode=yes"

START_TIME=$(date +%s)
SSH_SUCCESS=false
while true; do
    ELAPSED=$(($(date +%s) - START_TIME))
    if [ $ELAPSED -gt $SSH_TIMEOUT ]; then
        break
    fi

    verbose "Attempting SSH connection (${ELAPSED}s elapsed)..."
    if ssh $SSH_OPTS -p $SSH_PORT $SSH_TARGET "echo 'SSH_OK'" 2>/dev/null | grep -q "SSH_OK"; then
        SSH_SUCCESS=true
        break
    fi

    sleep 2
done

if [ "$SSH_SUCCESS" = true ]; then
    log "SSH connection successful!"
else
    error "SSH connection failed after ${SSH_TIMEOUT}s"

    # Get logs for debugging
    info "Fetching VM logs..."
    LOGS=$(curl -s "$API_URL/vms/$VM_ID/logs?lines=50")
    echo "$LOGS" | jq -r '.logs // "No logs available"' | tail -30

    exit 1
fi

# Step 5: Run a test command
info "Running test command..."
TEST_OUTPUT=$(ssh $SSH_OPTS -p $SSH_PORT $SSH_TARGET "hostname && whoami && cat /etc/os-release | head -3" 2>/dev/null)
echo "$TEST_OUTPUT"
log "Test command executed successfully"

# Step 6: Test network connectivity from inside VM
info "Testing network from inside VM..."
if ssh $SSH_OPTS -p $SSH_PORT $SSH_TARGET "ping -c 1 -W 2 8.8.8.8" &>/dev/null; then
    log "External network connectivity OK"
else
    warn "External network not reachable (may be expected)"
fi

echo ""
echo "============================================"
echo -e "${GREEN}  All Tests Passed!${NC}"
echo "============================================"
echo ""
echo "VM ID:    $VM_ID"
echo "Guest IP: $GUEST_IP"
echo "SSH:      ssh $SSH_OPTS -p $SSH_PORT $SSH_TARGET"
echo ""

if [ "$KEEP_VM" = true ]; then
    echo "VM kept (use --keep was specified)"
    echo "Delete with: curl -X DELETE $API_URL/vms/$VM_ID"
else
    echo "VM will be deleted on exit"
fi
