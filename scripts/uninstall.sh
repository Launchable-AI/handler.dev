#!/bin/bash
# Uninstall Handler VM support
#
# This script removes all system modifications made by the setup scripts.
#
# Usage: sudo ./scripts/uninstall.sh [options]
#
# Options:
#   --keep-data    Preserve ~/.local/share/handler/ (VMs, images, keys)
#   --force        Don't prompt for confirmation
#   -h, --help     Show this help

set -e

# Configuration
INSTALL_DIR="/usr/local/lib/handler"
BINARY_NAME="handler-tap-helper"
BRIDGE_NAME="handler-br0"
SERVICE_NAME="handler-bridge.service"
SYSCTL_FILE="/etc/sysctl.d/99-handler.conf"
NFTABLES_TABLE="handler"

# Handle sudo: use SUDO_USER's home if running as root via sudo
if [ -n "$SUDO_USER" ]; then
    DATA_DIR=$(getent passwd "$SUDO_USER" | cut -d: -f6)/.local/share/handler
else
    DATA_DIR="$HOME/.local/share/handler"
fi

# Defaults
KEEP_DATA=false
FORCE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step() { echo -e "\n${BLUE}==>${NC} $*"; }

usage() {
    echo "Uninstall Handler VM support"
    echo ""
    echo "Usage: sudo $0 [options]"
    echo ""
    echo "Options:"
    echo "  --keep-data    Preserve ~/.local/share/handler/ (VMs, images, keys)"
    echo "  --force        Don't prompt for confirmation"
    echo "  -h, --help     Show this help"
    echo ""
    echo "This removes:"
    echo "  - TAP helper binary and symlink"
    echo "  - Network bridge ($BRIDGE_NAME)"
    echo "  - NAT rules (nftables: $NFTABLES_TABLE table)"
    echo "  - Systemd service ($SERVICE_NAME)"
    echo "  - Sysctl configuration"
    echo "  - Firecracker binaries (if installed by setup)"
    echo "  - User data (unless --keep-data)"
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-data)
            KEEP_DATA=true
            shift
            ;;
        --force)
            FORCE=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error "This script must be run with sudo"
fi

echo "============================================"
echo "  Handler Uninstaller"
echo "============================================"
echo ""
echo "This will remove:"
echo "  - TAP helper: $INSTALL_DIR/$BINARY_NAME"
echo "  - Symlink: /usr/local/bin/$BINARY_NAME"
echo "  - Bridge: $BRIDGE_NAME"
echo "  - NAT rules: nftables table '$NFTABLES_TABLE'"
echo "  - Service: $SERVICE_NAME"
echo "  - Sysctl: $SYSCTL_FILE"
if [ "$KEEP_DATA" = false ]; then
    echo "  - User data: $DATA_DIR"
else
    echo "  - User data: KEEPING (--keep-data)"
fi
echo ""

# Confirmation
if [ "$FORCE" = false ]; then
    read -p "Continue with uninstall? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# Check for running VMs
step "Checking for running VMs..."
VM_PIDS=$(pgrep -f "firecracker" 2>/dev/null || true)
if [ -n "$VM_PIDS" ]; then
    warn "Found running VMs. Please stop them first:"
    ps -p $VM_PIDS -o pid,cmd 2>/dev/null || true
    if [ "$FORCE" = false ]; then
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted. Stop VMs first with: ./scripts/status.sh"
            exit 1
        fi
    fi
fi

# Stop and disable systemd service
step "Removing systemd service..."
if systemctl is-active "$SERVICE_NAME" &> /dev/null; then
    systemctl stop "$SERVICE_NAME" || warn "Failed to stop service"
    log "Service stopped"
fi

if systemctl is-enabled "$SERVICE_NAME" &> /dev/null; then
    systemctl disable "$SERVICE_NAME" || warn "Failed to disable service"
    log "Service disabled"
fi

if [ -f "/etc/systemd/system/$SERVICE_NAME" ]; then
    rm -f "/etc/systemd/system/$SERVICE_NAME"
    systemctl daemon-reload
    log "Service file removed"
else
    log "Service file not found (already removed)"
fi

# Delete network bridge
step "Removing network bridge..."
if [ -d "/sys/class/net/$BRIDGE_NAME" ]; then
    ip link set "$BRIDGE_NAME" down 2>/dev/null || true
    ip link delete "$BRIDGE_NAME" 2>/dev/null || warn "Failed to delete bridge"
    log "Bridge $BRIDGE_NAME removed"
else
    log "Bridge not found (already removed)"
fi

# Remove orphaned TAP devices
TAP_DEVICES=$(ls /sys/class/net/ 2>/dev/null | grep "^tap-" || true)
if [ -n "$TAP_DEVICES" ]; then
    log "Cleaning up orphaned TAP devices..."
    for tap in $TAP_DEVICES; do
        ip link delete "$tap" 2>/dev/null || warn "Failed to delete $tap"
        log "  Deleted $tap"
    done
fi

# Remove NAT rules
step "Removing NAT rules..."
if command -v nft &> /dev/null; then
    if nft list table ip "$NFTABLES_TABLE" &> /dev/null; then
        nft delete table ip "$NFTABLES_TABLE" || warn "Failed to delete nftables table"
        log "Removed nftables table: $NFTABLES_TABLE"
    else
        log "nftables table not found (already removed)"
    fi
fi

# Note: We don't try to remove iptables rules as they're harder to identify
# and may have been added manually

# Remove sysctl configuration
step "Removing sysctl configuration..."
if [ -f "$SYSCTL_FILE" ]; then
    rm -f "$SYSCTL_FILE"
    log "Removed $SYSCTL_FILE"
else
    log "Sysctl file not found (already removed)"
fi

# Note: We don't disable ip_forward as other services may need it
# Just remove our config file

# Remove binaries
step "Removing binaries..."

# TAP helper
if [ -L "/usr/local/bin/$BINARY_NAME" ]; then
    rm -f "/usr/local/bin/$BINARY_NAME"
    log "Removed symlink: /usr/local/bin/$BINARY_NAME"
fi

if [ -d "$INSTALL_DIR" ]; then
    rm -rf "$INSTALL_DIR"
    log "Removed: $INSTALL_DIR"
fi

# genisoimage wrapper (created on Arch Linux for mkisofs compatibility)
if [ -f "/usr/local/bin/genisoimage" ]; then
    # Only remove if it's our wrapper script (not a real package binary)
    if head -1 /usr/local/bin/genisoimage 2>/dev/null | grep -q "^#!/bin/sh"; then
        if grep -q "exec mkisofs" /usr/local/bin/genisoimage 2>/dev/null; then
            rm -f /usr/local/bin/genisoimage
            log "Removed genisoimage wrapper"
        fi
    fi
fi

# Firecracker (only if in standard location)
if [ -f "/usr/local/bin/firecracker" ]; then
    read -p "Remove Firecracker binaries? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]] || [ "$FORCE" = true ]; then
        rm -f "/usr/local/bin/firecracker" "/usr/local/bin/jailer"
        log "Removed Firecracker binaries"
    fi
fi

# Remove Handler API firewall rules
step "Removing Handler API firewall rules..."
HANDLER_PORT="${HANDLER_PORT:-4001}"
for iface in docker0 "br-+" "fc-tap+" "tap-+"; do
    if iptables -C INPUT -i "$iface" -p tcp --dport "$HANDLER_PORT" -j DROP 2>/dev/null; then
        iptables -D INPUT -i "$iface" -p tcp --dport "$HANDLER_PORT" -j DROP
        log "Removed iptables rule for $iface"
    fi
done

# Remove user data
step "Handling user data..."
if [ "$KEEP_DATA" = true ]; then
    log "Keeping user data at: $DATA_DIR"
else
    if [ -d "$DATA_DIR" ]; then
        # Show what will be deleted
        if [ -d "$DATA_DIR/vms" ]; then
            VM_COUNT=$(find "$DATA_DIR/vms" -maxdepth 1 -type d 2>/dev/null | wc -l)
            VM_COUNT=$((VM_COUNT - 1))
            [ $VM_COUNT -gt 0 ] && warn "Will delete $VM_COUNT VM(s)"
        fi
        if [ -d "$DATA_DIR/base-images" ]; then
            IMG_COUNT=$(find "$DATA_DIR/base-images" -maxdepth 1 -type d 2>/dev/null | wc -l)
            IMG_COUNT=$((IMG_COUNT - 1))
            [ $IMG_COUNT -gt 0 ] && warn "Will delete $IMG_COUNT base image(s)"
        fi

        if [ "$FORCE" = false ]; then
            read -p "Delete all user data at $DATA_DIR? [y/N] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                log "Keeping user data"
            else
                rm -rf "$DATA_DIR"
                log "Removed: $DATA_DIR"
            fi
        else
            rm -rf "$DATA_DIR"
            log "Removed: $DATA_DIR"
        fi
    else
        log "User data directory not found"
    fi
fi

echo ""
echo "============================================"
echo -e "${GREEN}  Uninstall Complete${NC}"
echo "============================================"
echo ""
echo "Handler VM support has been removed."
echo ""
if [ "$KEEP_DATA" = true ] && [ -d "$DATA_DIR" ]; then
    echo "User data preserved at: $DATA_DIR"
    echo "To remove manually: rm -rf $DATA_DIR"
fi
echo ""
echo "To reinstall: sudo ./scripts/setup.sh"
