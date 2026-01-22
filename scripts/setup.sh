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

# Source OS utilities for cross-platform package management
source "$SCRIPT_DIR/lib/os-utils.sh"

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

# Defaults - both hypervisors optional, user chooses interactively
INSTALL_CLOUD_HYPERVISOR=false
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

# Prompt for yes/no with default
# Usage: prompt_yn "Question?" [Y|N]
# Returns 0 for yes, 1 for no
prompt_yn() {
    local prompt="$1"
    local default="${2:-Y}"

    if [ "$UNATTENDED" = true ]; then
        [[ "$default" =~ ^[Yy]$ ]] && return 0 || return 1
    fi

    local yn_hint
    if [[ "$default" =~ ^[Yy]$ ]]; then
        yn_hint="[Y/n]"
    else
        yn_hint="[y/N]"
    fi

    read -p "$prompt $yn_hint " -n 1 -r
    echo

    if [[ -z "$REPLY" ]]; then
        [[ "$default" =~ ^[Yy]$ ]] && return 0 || return 1
    fi

    [[ "$REPLY" =~ ^[Yy]$ ]] && return 0 || return 1
}

usage() {
    echo "Caisson Setup Script"
    echo ""
    echo "Usage: sudo $0 [options]"
    echo ""
    echo "Options:"
    echo "  --cloud-hypervisor  Pre-select Cloud-Hypervisor support"
    echo "  --firecracker       Pre-select Firecracker support"
    echo "  --all               Install both hypervisors"
    echo "  --skip-image        Skip base image download"
    echo "  --unattended        Non-interactive mode (use defaults)"
    echo "  -h, --help          Show this help"
    echo ""
    echo "When run interactively (default), you will be prompted for:"
    echo "  - Cloud-Hypervisor support (QCOW2 images, UEFI boot)"
    echo "  - Firecracker support (lightweight microVMs)"
    echo "  - Base image download"
    echo ""
    echo "This script installs:"
    echo "  - TAP helper binary with CAP_NET_ADMIN capability"
    echo "  - Network bridge ($BRIDGE_NAME) with NAT"
    echo "  - Systemd service for persistence"
    echo "  - Base images for selected hypervisors (optional)"
    echo ""
    echo "Data directory: \$HOME/.local/share/caisson"
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --cloud-hypervisor)
            INSTALL_CLOUD_HYPERVISOR=true
            shift
            ;;
        --firecracker)
            INSTALL_FIRECRACKER=true
            shift
            ;;
        --all)
            INSTALL_CLOUD_HYPERVISOR=true
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
echo "Detected: $OS_NAME ($PKG_MANAGER)"
echo "Data directory: $DATA_DIR"
echo ""

#
# Interactive configuration (unless --unattended)
#
if [ "$UNATTENDED" = false ]; then
    echo -e "${BLUE}Select hypervisors to install:${NC}"
    echo ""

    # Ask about Cloud-Hypervisor if not already set via command line
    if [ "$INSTALL_CLOUD_HYPERVISOR" = false ]; then
        if prompt_yn "Install Cloud-Hypervisor support? (QCOW2 images, standard VMs)" Y; then
            INSTALL_CLOUD_HYPERVISOR=true
        fi
    fi

    # Ask about Firecracker if not already set via command line
    if [ "$INSTALL_FIRECRACKER" = false ]; then
        if prompt_yn "Install Firecracker support? (lightweight microVMs)" N; then
            INSTALL_FIRECRACKER=true
        fi
    fi

    # Warn if no hypervisor selected
    if [ "$INSTALL_CLOUD_HYPERVISOR" = false ] && [ "$INSTALL_FIRECRACKER" = false ]; then
        warn "No hypervisor selected. You'll need at least one to run VMs."
        if ! prompt_yn "Continue anyway?" N; then
            echo "Aborted."
            exit 0
        fi
    fi

    # Only ask about images if a hypervisor is selected and not skipped via command line
    if [ "$SKIP_IMAGE" = false ]; then
        if [ "$INSTALL_CLOUD_HYPERVISOR" = true ] || [ "$INSTALL_FIRECRACKER" = true ]; then
            if ! prompt_yn "Download base VM images?" Y; then
                SKIP_IMAGE=true
            fi
        fi
    fi

    echo ""
fi

echo "Configuration:"
echo "  Bridge: $BRIDGE_NAME ($BRIDGE_IP)"
echo "  Cloud-Hypervisor: $INSTALL_CLOUD_HYPERVISOR"
echo "  Firecracker: $INSTALL_FIRECRACKER"
echo "  Download images: $([ "$SKIP_IMAGE" = false ] && echo "yes" || echo "no")"
echo ""

if [ "$UNATTENDED" = false ]; then
    if ! prompt_yn "Proceed with installation?" Y; then
        echo "Aborted."
        exit 0
    fi
fi

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
    if prompt_yn "Add $REAL_USER to $KVM_GROUP group?" Y; then
        usermod -aG "$KVM_GROUP" "$REAL_USER"
        log "Added $REAL_USER to $KVM_GROUP group (re-login required)"
    fi
fi

# Check required packages
MISSING_PKGS=()
command -v setcap &> /dev/null || MISSING_PKGS+=("libcap2-bin")
command -v qemu-img &> /dev/null || MISSING_PKGS+=("qemu-utils")
# genisoimage or mkisofs (cdrtools) - both work for creating cloud-init ISOs
command -v genisoimage &> /dev/null || command -v mkisofs &> /dev/null || MISSING_PKGS+=("genisoimage")

# Check for Rust/Cargo (needed to build tap-helper if not pre-built)
HELPER_BINARY="$PROJECT_ROOT/helpers/tap-helper/target/release/caisson-tap-helper"
if [ ! -f "$HELPER_BINARY" ]; then
    # Check for cargo in PATH or in user's rustup installation
    if ! command -v cargo &> /dev/null && [ ! -f "$REAL_HOME/.cargo/bin/cargo" ]; then
        MISSING_PKGS+=("cargo")
    fi
fi

if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
    log "Installing required packages: ${MISSING_PKGS[*]} (using $PKG_MANAGER)"
    pkg_update
    pkg_install "${MISSING_PKGS[@]}"
fi

# On systems with mkisofs but not genisoimage (e.g., Arch with cdrtools),
# create a wrapper so that code expecting 'genisoimage' still works
if ! command -v genisoimage &> /dev/null && command -v mkisofs &> /dev/null; then
    log "Creating genisoimage wrapper for mkisofs compatibility"
    cat > /usr/local/bin/genisoimage << 'EOF'
#!/bin/sh
exec mkisofs "$@"
EOF
    chmod +x /usr/local/bin/genisoimage
fi

log "Prerequisites OK"

#
# Step 2: Install TAP helper
#
step "Installing TAP helper..."

# Run the install script (it handles building if needed)
"$SCRIPT_DIR/install-tap-helper.sh" --setup-bridge --bridge-name "$BRIDGE_NAME" --bridge-ip "$BRIDGE_IP"

#
# Step 3: Download base images
#
if [ "$SKIP_IMAGE" = false ] && { [ "$INSTALL_CLOUD_HYPERVISOR" = true ] || [ "$INSTALL_FIRECRACKER" = true ]; }; then
    step "Setting up base images..."

    # Create data directory
    mkdir -p "$DATA_DIR/base-images"
    chown -R "$REAL_USER:$(id -gn $REAL_USER)" "$DATA_DIR"

    # Download Cloud-Hypervisor image if selected
    if [ "$INSTALL_CLOUD_HYPERVISOR" = true ]; then
        if [ -f "$DATA_DIR/base-images/ubuntu-minimal-24.04/image.qcow2" ]; then
            log "Cloud-Hypervisor image already exists"
        else
            log "Downloading Cloud-Hypervisor image..."
            sudo -H -u "$REAL_USER" env CAISSON_DATA_DIR="$DATA_DIR" "$SCRIPT_DIR/download-ubuntu-minimal.sh"
        fi
    fi

    # Download Firecracker image if selected
    if [ "$INSTALL_FIRECRACKER" = true ]; then
        if [ -f "$DATA_DIR/base-images/ubuntu-24.04/rootfs.ext4" ] && [ -f "$DATA_DIR/base-images/ubuntu-24.04/vmlinux" ]; then
            log "Firecracker image already exists"
        else
            log "Downloading Firecracker image..."
            sudo -H -u "$REAL_USER" env CAISSON_DATA_DIR="$DATA_DIR" "$SCRIPT_DIR/download-fc-image.sh"
        fi
    fi
else
    if [ "$SKIP_IMAGE" = true ]; then
        log "Skipping image download (--skip-image)"
    fi
fi

#
# Step 4: Install hypervisor binaries
#

# Install Cloud-Hypervisor if selected
if [ "$INSTALL_CLOUD_HYPERVISOR" = true ]; then
    step "Checking Cloud-Hypervisor..."

    if command -v cloud-hypervisor &> /dev/null; then
        CH_VERSION=$(cloud-hypervisor --version 2>&1 | head -1)
        log "Cloud-Hypervisor already installed: $CH_VERSION"
    else
        warn "Cloud-Hypervisor not installed"
        log "Install from: https://github.com/cloud-hypervisor/cloud-hypervisor/releases"
        log "Or use your package manager: $(pkg_install_hint cloud-hypervisor 2>/dev/null || echo 'check your distro')"
    fi
fi

# Install Firecracker if selected
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
