#!/bin/bash
# Check Handler installation status
#
# Usage: ./scripts/status.sh
#
# Exit codes:
#   0 - All checks passed, ready to use
#   1 - Some checks failed, setup incomplete

set -e

# Configuration
INSTALL_DIR="/usr/local/lib/handler"
BINARY_NAME="handler-tap-helper"
BRIDGE_NAME="handler-br0"
SERVICE_NAME="handler-bridge.service"
DATA_DIR="$HOME/.local/share/handler"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Status tracking
ERRORS=0
WARNINGS=0

ok()   { echo -e "${GREEN}[OK]${NC} $*"; }
warn() { echo -e "${YELLOW}[--]${NC} $*"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo -e "${RED}[!!]${NC} $*"; ERRORS=$((ERRORS + 1)); }
info() { echo -e "${BLUE}[i]${NC} $*"; }

echo "============================================"
echo "  Handler Installation Status"
echo "============================================"
echo ""

# Check KVM access
echo "Checking prerequisites..."
if [ -e /dev/kvm ]; then
    if [ -r /dev/kvm ] && [ -w /dev/kvm ]; then
        ok "KVM access available"
    else
        KVM_GROUP=$(stat -c '%G' /dev/kvm 2>/dev/null || echo "kvm")
        fail "KVM exists but no access (add user to '$KVM_GROUP' group)"
    fi
else
    fail "KVM not available (/dev/kvm missing)"
fi

echo ""
echo "Checking TAP helper..."

# Check binary exists
if [ -f "$INSTALL_DIR/$BINARY_NAME" ]; then
    ok "Binary installed: $INSTALL_DIR/$BINARY_NAME"
else
    fail "Binary not found: $INSTALL_DIR/$BINARY_NAME"
fi

# Check symlink
if [ -L "/usr/local/bin/$BINARY_NAME" ]; then
    ok "Symlink exists: /usr/local/bin/$BINARY_NAME"
else
    warn "Symlink missing: /usr/local/bin/$BINARY_NAME"
fi

# Check capabilities
if command -v getcap &> /dev/null && [ -f "$INSTALL_DIR/$BINARY_NAME" ]; then
    if getcap "$INSTALL_DIR/$BINARY_NAME" 2>/dev/null | grep -q "cap_net_admin"; then
        ok "CAP_NET_ADMIN capability set"
    else
        fail "CAP_NET_ADMIN capability NOT set"
    fi
else
    warn "Cannot verify capabilities (getcap not available)"
fi

echo ""
echo "Checking network..."

# Check bridge
if [ -d "/sys/class/net/$BRIDGE_NAME" ]; then
    BRIDGE_IP=$(ip -4 addr show "$BRIDGE_NAME" 2>/dev/null | grep -oP 'inet \K[\d.]+/\d+' | head -1)
    if [ -n "$BRIDGE_IP" ]; then
        ok "Bridge exists: $BRIDGE_NAME ($BRIDGE_IP)"
    else
        warn "Bridge exists but has no IP: $BRIDGE_NAME"
    fi
else
    fail "Bridge not found: $BRIDGE_NAME"
fi

# Check NAT rules
if command -v nft &> /dev/null; then
    # nft requires root to query tables, so use sudo if available
    if sudo -n nft list table ip handler &> /dev/null 2>&1; then
        ok "NAT rules configured (nftables: handler table)"
    elif nft list table ip handler &> /dev/null 2>&1; then
        ok "NAT rules configured (nftables: handler table)"
    else
        # Can't determine - might be permission issue or actually missing
        warn "NAT rules status unknown (run with sudo to verify)"
    fi
elif command -v iptables &> /dev/null; then
    if iptables -t nat -L POSTROUTING -n 2>/dev/null | grep -q "172.31.0.0"; then
        ok "NAT rules configured (iptables)"
    else
        warn "NAT rules may be missing (iptables)"
    fi
else
    warn "Cannot verify NAT rules (nft/iptables not available)"
fi

# Check IP forwarding
IP_FORWARD=$(cat /proc/sys/net/ipv4/ip_forward 2>/dev/null)
if [ "$IP_FORWARD" = "1" ]; then
    ok "IP forwarding enabled"
else
    fail "IP forwarding disabled"
fi

echo ""
echo "Checking systemd service..."

# Check systemd service
if [ -f "/etc/systemd/system/$SERVICE_NAME" ]; then
    ok "Service file exists: $SERVICE_NAME"

    if systemctl is-enabled "$SERVICE_NAME" &> /dev/null; then
        ok "Service enabled (starts on boot)"
    else
        warn "Service not enabled"
    fi

    if systemctl is-active "$SERVICE_NAME" &> /dev/null; then
        ok "Service active"
    else
        warn "Service not active"
    fi
else
    warn "Service file not found: $SERVICE_NAME"
fi

echo ""
echo "Checking optional components..."

# Check Firecracker
if command -v firecracker &> /dev/null; then
    FC_VERSION=$(firecracker --version 2>&1 | head -1)
    ok "Firecracker installed: $FC_VERSION"
else
    warn "Firecracker not installed (optional)"
fi

echo ""
echo "Checking base images..."

# Check base images directory
if [ -d "$DATA_DIR/base-images" ]; then
    IMAGE_COUNT=$(find "$DATA_DIR/base-images" -maxdepth 1 -type d | wc -l)
    IMAGE_COUNT=$((IMAGE_COUNT - 1))  # Subtract the directory itself
    if [ "$IMAGE_COUNT" -gt 0 ]; then
        ok "Base images directory: $DATA_DIR/base-images ($IMAGE_COUNT images)"

        # List images
        for img_dir in "$DATA_DIR/base-images"/*/; do
            if [ -d "$img_dir" ]; then
                img_name=$(basename "$img_dir")
                has_rootfs=""
                has_kernel=""

                [ -f "$img_dir/rootfs.ext4" ] && has_rootfs="rootfs"
                [ -f "$img_dir/vmlinux" ] && has_kernel="kernel"
                [ -f "$img_dir/kernel" ] && has_kernel="kernel"

                formats=$(echo "$has_rootfs $has_kernel" | xargs)
                info "  - $img_name: $formats"
            fi
        done
    else
        warn "No base images found"
    fi
else
    warn "Base images directory not found"
fi

echo ""
echo "============================================"

if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}  Status: Ready${NC}"
    echo "============================================"
    echo ""
    echo "Handler is ready to create VMs."
    exit 0
else
    echo -e "${RED}  Status: Setup Incomplete${NC}"
    echo "============================================"
    echo ""
    echo "Run setup to fix issues:"
    echo "  sudo ./scripts/setup.sh"
    exit 1
fi
