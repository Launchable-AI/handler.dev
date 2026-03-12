#!/bin/bash
# Unified Handler setup script
#
# This script sets up VM support for Handler, including:
# - TAP helper with network capabilities
# - Network bridge and NAT rules
# - Base VM images
# - Firecracker microVM support
#
# Usage: sudo ./scripts/setup.sh [options]
#
# Options:
#   --firecracker    Install Firecracker support
#   --skip-image     Skip base image download
#   --unattended     Non-interactive mode (auto-yes)
#   -h, --help       Show this help

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Source OS utilities for cross-platform package management
source "$SCRIPT_DIR/lib/os-utils.sh"

# Configuration
BRIDGE_NAME="handler-br0"
BRIDGE_IP="192.168.127.1/24"

# Handle sudo: use SUDO_USER's home if running as root via sudo
if [ -n "$SUDO_USER" ]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    REAL_USER="$SUDO_USER"
else
    REAL_HOME="$HOME"
    REAL_USER="$USER"
fi

DATA_DIR="$PROJECT_ROOT/data"

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
    echo "Handler Setup Script"
    echo ""
    echo "Usage: sudo $0 [options]"
    echo ""
    echo "Options:"
    echo "  --firecracker       Install Firecracker support"
    echo "  --skip-image        Skip base image download"
    echo "  --unattended        Non-interactive mode (use defaults)"
    echo "  -h, --help          Show this help"
    echo ""
    echo "When run interactively (default), you will be prompted for:"
    echo "  - Firecracker support (lightweight microVMs)"
    echo "  - Base image download"
    echo ""
    echo "This script installs:"
    echo "  - TAP helper binary with CAP_NET_ADMIN capability"
    echo "  - Network bridge ($BRIDGE_NAME) with NAT"
    echo "  - Systemd service for persistence"
    echo "  - Base images (optional)"
    echo ""
    echo "Data directory: <project>/data"
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
echo "  Handler Setup"
echo "============================================"
echo ""
echo "Detected: $OS_NAME ($PKG_MANAGER)"
echo "Data directory: $DATA_DIR"
echo ""

#
# Interactive configuration (unless --unattended)
#
if [ "$UNATTENDED" = false ]; then
    # Ask about Firecracker if not already set via command line
    if [ "$INSTALL_FIRECRACKER" = false ]; then
        if prompt_yn "Install Firecracker support? (lightweight microVMs)" Y; then
            INSTALL_FIRECRACKER=true
        fi
    fi

    # Only ask about images if Firecracker is selected and not skipped via command line
    if [ "$SKIP_IMAGE" = false ]; then
        if [ "$INSTALL_FIRECRACKER" = true ]; then
            if ! prompt_yn "Download base VM images?" Y; then
                SKIP_IMAGE=true
            fi
        fi
    fi

    echo ""
fi

echo "Configuration:"
echo "  Bridge: $BRIDGE_NAME ($BRIDGE_IP)"
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
command -v zerofree &> /dev/null || MISSING_PKGS+=("zerofree")

# Check for Rust/Cargo (needed to build tap-helper if not pre-built)
HELPER_BINARY="$PROJECT_ROOT/helpers/tap-helper/target/release/handler-tap-helper"
NEED_RUST=false
if [ ! -f "$HELPER_BINARY" ]; then
    # Check for cargo in PATH or in user's rustup installation
    if ! command -v cargo &> /dev/null && [ ! -f "$REAL_HOME/.cargo/bin/cargo" ]; then
        NEED_RUST=true
    fi
fi

if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
    log "Installing required packages: ${MISSING_PKGS[*]} (using $PKG_MANAGER)"
    pkg_update
    pkg_install "${MISSING_PKGS[@]}"
fi

# Install Rust via rustup (distro packages are often too old for Cargo.lock v4)
if [ "$NEED_RUST" = true ]; then
    log "Installing Rust/Cargo via rustup..."
    sudo -u "$REAL_USER" bash -c 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --quiet'
    if [ ! -f "$REAL_HOME/.cargo/bin/cargo" ]; then
        echo "[ERROR] Failed to install Rust/Cargo via rustup"
        exit 1
    fi
fi

# Install Node.js 22+ if not present
# Check the real user's node (nvm, fnm, system — whatever their login shell provides)
NVM_DIR="$REAL_HOME/.nvm"
USER_NODE_VERSION=$(sudo -u "$REAL_USER" bash -lc "node -e 'console.log(parseInt(process.version.slice(1)))'" 2>/dev/null || echo "")

if [ -z "$USER_NODE_VERSION" ] || [ "$USER_NODE_VERSION" -lt 22 ] 2>/dev/null; then
    log "Node.js 22+ not found, installing via nvm (does not touch system packages)..."
    if [ ! -s "$NVM_DIR/nvm.sh" ]; then
        sudo -u "$REAL_USER" bash -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash'
        if [ ! -s "$NVM_DIR/nvm.sh" ]; then
            echo "[ERROR] Failed to install nvm"
            exit 1
        fi
    fi
    sudo -u "$REAL_USER" bash -c "source '$NVM_DIR/nvm.sh' && nvm install 22 && nvm alias default 22"
    if ! sudo -u "$REAL_USER" bash -c "source '$NVM_DIR/nvm.sh' && node --version" | grep -q '^v2[2-9]'; then
        echo "[ERROR] Failed to install Node.js 22 via nvm"
        exit 1
    fi
    log "Node.js 22 installed via nvm"
else
    log "Node.js $USER_NODE_VERSION already installed"
fi

# Helper: run a command as the real user with node/pnpm on PATH
# Uses login shell (-l) to pick up nvm/fnm/system node, plus pnpm's standalone install path
run_as_user() {
    sudo -u "$REAL_USER" bash -lc "export PNPM_HOME=\"\$HOME/.local/share/pnpm\" && export PATH=\"\$PNPM_HOME:\$PATH\" && $1"
}

# Install pnpm if not present
if ! run_as_user "command -v pnpm" &> /dev/null; then
    log "Installing pnpm..."
    run_as_user "curl -fsSL https://get.pnpm.io/install.sh | sh -"
    if ! run_as_user "command -v pnpm" &> /dev/null; then
        echo "[ERROR] Failed to install pnpm"
        exit 1
    fi
fi

# Install project dependencies
log "Installing project dependencies..."
run_as_user "cd '$PROJECT_ROOT' && pnpm install"

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
"$SCRIPT_DIR/user/install-tap-helper.sh" --setup-bridge --bridge-name "$BRIDGE_NAME" --bridge-ip "$BRIDGE_IP"

#
# Step 3: Download base images
#
if [ "$SKIP_IMAGE" = false ] && [ "$INSTALL_FIRECRACKER" = true ]; then
    step "Setting up base images..."

    # Create data directory
    mkdir -p "$DATA_DIR/base-images"
    chown -R "$REAL_USER:$(id -gn $REAL_USER)" "$DATA_DIR"

    # Download Firecracker image if selected
    # The download script auto-resolves the default image from the global manifest
    # Check if any Firecracker image already exists (rootfs.ext4 + vmlinux in any base-images subdir)
    FC_IMAGE_EXISTS=false
    if [ -d "$DATA_DIR/base-images" ]; then
        for imgdir in "$DATA_DIR/base-images"/*/; do
            if [ -f "${imgdir}rootfs.ext4" ] && [ -f "${imgdir}vmlinux" ]; then
                FC_IMAGE_EXISTS=true
                log "Firecracker image already exists: $(basename "$imgdir")"
                break
            fi
        done
    fi

    if [ "$FC_IMAGE_EXISTS" = false ]; then
        log "Downloading Firecracker image..."
        sudo -H -u "$REAL_USER" env HANDLER_DATA_DIR="$DATA_DIR" "$SCRIPT_DIR/user/download-image.sh"
    fi
else
    if [ "$SKIP_IMAGE" = true ]; then
        log "Skipping image download (--skip-image)"
    fi
fi

#
# Step 4: Install hypervisor binaries
#

# Install Firecracker if selected
if [ "$INSTALL_FIRECRACKER" = true ]; then
    step "Installing Firecracker..."

    if command -v firecracker &> /dev/null; then
        FC_VERSION=$(firecracker --version 2>&1 | head -1)
        log "Firecracker already installed: $FC_VERSION"
    else
        "$SCRIPT_DIR/user/install-firecracker.sh"
    fi
fi

#
# Step 5: Firewall rules (defense in depth)
#
step "Adding firewall rules to block sandbox-to-host API traffic..."

HANDLER_PORT="${HANDLER_PORT:-4001}"

# Docker bridge interfaces
iptables -C INPUT -i docker0 -p tcp --dport "$HANDLER_PORT" -j DROP 2>/dev/null || \
  iptables -I INPUT -i docker0 -p tcp --dport "$HANDLER_PORT" -j DROP
log "Blocked docker0 → host:$HANDLER_PORT"

# Custom Docker bridge networks (br-* interfaces)
iptables -C INPUT -i br-+ -p tcp --dport "$HANDLER_PORT" -j DROP 2>/dev/null || \
  iptables -I INPUT -i br-+ -p tcp --dport "$HANDLER_PORT" -j DROP
log "Blocked br-+ → host:$HANDLER_PORT"

# Firecracker TAP interfaces
iptables -C INPUT -i fc-tap+ -p tcp --dport "$HANDLER_PORT" -j DROP 2>/dev/null || \
  iptables -I INPUT -i fc-tap+ -p tcp --dport "$HANDLER_PORT" -j DROP
log "Blocked fc-tap+ → host:$HANDLER_PORT"

# Handler bridge TAP interfaces
iptables -C INPUT -i tap-+ -p tcp --dport "$HANDLER_PORT" -j DROP 2>/dev/null || \
  iptables -I INPUT -i tap-+ -p tcp --dport "$HANDLER_PORT" -j DROP
log "Blocked tap-+ → host:$HANDLER_PORT"

#
# Step 6: Verify installation
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
echo "  1. Reload your shell: source ~/.bashrc"
echo "  2. Start the server: pnpm dev"
echo "  3. Open http://localhost:4000"
echo "  4. Create a VM from the VMs tab"
echo ""
if groups "$REAL_USER" | grep -qw "$KVM_GROUP"; then
    :
else
    echo -e "${YELLOW}NOTE: Log out and back in for KVM group to take effect${NC}"
    echo ""
fi
echo "To check status: ./scripts/status.sh"
echo "To uninstall: sudo ./scripts/uninstall.sh"
