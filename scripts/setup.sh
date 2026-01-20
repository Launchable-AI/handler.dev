#!/bin/bash
# Unified Caisson setup script
#
# This script sets up VM support for Caisson, including:
# - TAP helper with network capabilities
# - Network bridge and NAT rules
# - Base VM images
# - Optional Firecracker support
#
# Usage: sudo ./scripts/setup.sh [options]
#
# Options:
#   --firecracker    Also install Firecracker support
#   --skip-image     Skip base image download
#   --unattended     Non-interactive mode (auto-yes)
#   -h, --help       Show this help

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Configuration
BRIDGE_NAME="caisson-br0"
BRIDGE_IP="172.31.0.1/24"

# Handle sudo: use SUDO_USER's home if running as root via sudo
if [ -n "$SUDO_USER" ]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    REAL_USER="$SUDO_USER"
else
    REAL_HOME="$HOME"
    REAL_USER="$USER"
fi

DATA_DIR="$REAL_HOME/.local/share/caisson"

# Defaults
INSTALL_FIRECRACKER=false
SKIP_IMAGE=false
UNATTENDED=false

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
    echo "Caisson Setup Script"
    echo ""
    echo "Usage: sudo $0 [options]"
    echo ""
    echo "Options:"
    echo "  --firecracker    Also install Firecracker support"
    echo "  --skip-image     Skip base image download"
    echo "  --unattended     Non-interactive mode (auto-yes)"
    echo "  -h, --help       Show this help"
    echo ""
    echo "This script installs:"
    echo "  - TAP helper binary with CAP_NET_ADMIN capability"
    echo "  - Network bridge ($BRIDGE_NAME) with NAT"
    echo "  - Systemd service for persistence"
    echo "  - Ubuntu 24.04 base image for VMs"
    echo ""
    echo "Data directory: $DATA_DIR"
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --firecracker)
            INSTALL_FIRECRACKER=true
            shift
            ;;
        --skip-image)
            SKIP_IMAGE=true
            shift
            ;;
        --unattended)
            UNATTENDED=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            error "Unknown option: $1. Use --help for usage."
            ;;
    esac
done

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    error "This script must be run with sudo: sudo $0"
fi

echo "============================================"
echo "  Caisson Setup"
echo "============================================"
echo ""
echo "Configuration:"
echo "  Bridge: $BRIDGE_NAME ($BRIDGE_IP)"
echo "  Data: $DATA_DIR"
echo "  Firecracker: $INSTALL_FIRECRACKER"
echo ""

#
# Step 1: Check prerequisites
#
step "Checking prerequisites..."

# Check KVM
if [ ! -e /dev/kvm ]; then
    error "KVM not available. Ensure virtualization is enabled in BIOS/UEFI."
fi

KVM_GROUP=$(stat -c '%G' /dev/kvm 2>/dev/null || echo "kvm")
if ! groups "$REAL_USER" | grep -qw "$KVM_GROUP"; then
    warn "User '$REAL_USER' not in '$KVM_GROUP' group"
    if [ "$UNATTENDED" = true ]; then
        usermod -aG "$KVM_GROUP" "$REAL_USER"
        log "Added $REAL_USER to $KVM_GROUP group (re-login required)"
    else
        read -p "Add $REAL_USER to $KVM_GROUP group? [Y/n] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            usermod -aG "$KVM_GROUP" "$REAL_USER"
            log "Added $REAL_USER to $KVM_GROUP group (re-login required)"
        fi
    fi
fi

# Check required packages
MISSING_PKGS=""
command -v setcap &> /dev/null || MISSING_PKGS="$MISSING_PKGS libcap2-bin"
command -v qemu-img &> /dev/null || MISSING_PKGS="$MISSING_PKGS qemu-utils"
command -v genisoimage &> /dev/null || MISSING_PKGS="$MISSING_PKGS genisoimage"

if [ -n "$MISSING_PKGS" ]; then
    log "Installing required packages:$MISSING_PKGS"
    apt-get update -qq
    apt-get install -y -qq $MISSING_PKGS
fi

# Check for Rust (needed to build tap-helper)
HELPER_BINARY="$PROJECT_ROOT/helpers/tap-helper/target/release/caisson-tap-helper"
if [ ! -f "$HELPER_BINARY" ]; then
    if ! command -v cargo &> /dev/null; then
        error "Rust/Cargo required to build tap-helper. Install: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    fi
fi

log "Prerequisites OK"

#
# Step 2: Install TAP helper
#
step "Installing TAP helper..."

# Run the install script (it handles building if needed)
"$SCRIPT_DIR/install-tap-helper.sh" --setup-bridge --bridge-name "$BRIDGE_NAME" --bridge-ip "$BRIDGE_IP"

#
# Step 3: Download base image
#
if [ "$SKIP_IMAGE" = false ]; then
    step "Setting up base image..."

    # Create data directory
    mkdir -p "$DATA_DIR/base-images"
    chown -R "$REAL_USER:$(id -gn $REAL_USER)" "$DATA_DIR"

    # Check if image already exists
    if [ -f "$DATA_DIR/base-images/ubuntu-24.04/rootfs.ext4" ] && [ -f "$DATA_DIR/base-images/ubuntu-24.04/vmlinux" ]; then
        log "Firecracker image already exists, skipping download"
    elif [ -f "$DATA_DIR/base-images/ubuntu-minimal-24.04/image.qcow2" ]; then
        log "Cloud-hypervisor image already exists"
        # Check if we need FC image
        if [ "$INSTALL_FIRECRACKER" = true ]; then
            log "Downloading Firecracker-ready image..."
            sudo -u "$REAL_USER" "$SCRIPT_DIR/download-fc-image.sh"
        fi
    else
        # Download the appropriate image
        if [ "$INSTALL_FIRECRACKER" = true ]; then
            log "Downloading Firecracker-ready image..."
            sudo -u "$REAL_USER" "$SCRIPT_DIR/download-fc-image.sh"
        else
            log "Downloading cloud-hypervisor image..."
            sudo -u "$REAL_USER" "$SCRIPT_DIR/download-ubuntu-minimal.sh"
        fi
    fi
else
    log "Skipping image download (--skip-image)"
fi

#
# Step 4: Install Firecracker (optional)
#
if [ "$INSTALL_FIRECRACKER" = true ]; then
    step "Installing Firecracker..."

    if command -v firecracker &> /dev/null; then
        FC_VERSION=$(firecracker --version 2>&1 | head -1)
        log "Firecracker already installed: $FC_VERSION"
    else
        "$SCRIPT_DIR/install-firecracker.sh"
    fi
fi

#
# Step 5: Verify installation
#
step "Verifying installation..."

echo ""
"$SCRIPT_DIR/status.sh" || true

echo ""
echo "============================================"
echo -e "${GREEN}  Setup Complete!${NC}"
echo "============================================"
echo ""
echo "Next steps:"
echo "  1. Start the server: pnpm dev"
echo "  2. Open http://localhost:5173"
echo "  3. Create a VM from the VMs tab"
echo ""
if groups "$REAL_USER" | grep -qw "$KVM_GROUP"; then
    :
else
    echo -e "${YELLOW}NOTE: Log out and back in for KVM group to take effect${NC}"
    echo ""
fi
echo "To check status: ./scripts/status.sh"
echo "To uninstall: sudo ./scripts/uninstall.sh"
