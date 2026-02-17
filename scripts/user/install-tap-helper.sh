#!/bin/bash
# Install the TAP helper with appropriate capabilities
#
# This script needs to be run with sudo, but after installation,
# the main application can create TAP devices without root.
#
# Usage: sudo ./scripts/user/install-tap-helper.sh [options]
#
# Options:
#   --setup-bridge    Also set up the network bridge and NAT rules
#   --bridge-name     Bridge name (default: handler-br0)
#   --bridge-ip       Bridge IP in CIDR notation (default: 172.31.0.1/24)

set -e

# Configuration
INSTALL_DIR="${INSTALL_DIR:-/usr/local/lib/handler}"
BINARY_NAME="handler-tap-helper"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
HELPER_DIR="$PROJECT_ROOT/helpers/tap-helper"

# Source OS utilities for cross-platform package management
source "$(dirname "$SCRIPT_DIR")/lib/os-utils.sh"

# Default bridge settings
SETUP_BRIDGE=false
BRIDGE_NAME="handler-br0"
BRIDGE_IP="172.31.0.1/24"
BRIDGE_SUBNET="172.31.0.0/24"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --setup-bridge)
            SETUP_BRIDGE=true
            shift
            ;;
        --bridge-name)
            BRIDGE_NAME="$2"
            shift 2
            ;;
        --bridge-ip)
            BRIDGE_IP="$2"
            shift 2
            ;;
        -h|--help)
            echo "Install TAP helper with capabilities"
            echo ""
            echo "Usage: sudo $0 [options]"
            echo ""
            echo "Options:"
            echo "  --setup-bridge    Also set up the network bridge and NAT rules"
            echo "  --bridge-name     Bridge name (default: handler-br0)"
            echo "  --bridge-ip       Bridge IP in CIDR notation (default: 172.31.0.1/24)"
            echo ""
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run with sudo${NC}"
    echo "Usage: sudo $0"
    exit 1
fi

# Get real user (for ownership)
if [ -n "$SUDO_USER" ]; then
    REAL_USER="$SUDO_USER"
    REAL_UID=$(id -u "$SUDO_USER")
    REAL_GID=$(id -g "$SUDO_USER")
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    REAL_USER="$USER"
    REAL_UID=$(id -u)
    REAL_GID=$(id -g)
    REAL_HOME="$HOME"
fi

echo -e "${GREEN}Installing TAP helper for Handler${NC}"
echo ""

# Check for required tools
echo "Checking requirements..."
if ! command -v setcap &> /dev/null; then
    echo -e "${YELLOW}Installing libcap utilities...${NC}"
    pkg_update
    pkg_install libcap2-bin
fi

# Check if Rust/Cargo is available for building
BUILD_NEEDED=true
if [ -f "$HELPER_DIR/target/release/$BINARY_NAME" ]; then
    echo -e "${GREEN}Found pre-built binary${NC}"
    BUILD_NEEDED=false
fi

if [ "$BUILD_NEEDED" = true ]; then
    # Check for cargo in PATH or in user's rustup installation
    CARGO_CMD=""
    if command -v cargo &> /dev/null; then
        CARGO_CMD="cargo"
    elif [ -f "$REAL_HOME/.cargo/bin/cargo" ]; then
        CARGO_CMD="$REAL_HOME/.cargo/bin/cargo"
    fi

    # Install cargo if not found
    if [ -z "$CARGO_CMD" ]; then
        echo -e "${YELLOW}Installing Rust/Cargo...${NC}"
        pkg_update
        pkg_install cargo
        # After install, cargo should be in PATH
        if command -v cargo &> /dev/null; then
            CARGO_CMD="cargo"
        else
            echo -e "${RED}Error: Failed to install Rust/Cargo${NC}"
            exit 1
        fi
    fi

    echo "Building TAP helper..."
    cd "$HELPER_DIR"
    # Build as the real user to avoid permission issues
    sudo -u "$REAL_USER" "$CARGO_CMD" build --release
fi

# Create install directory
echo "Installing binary..."
mkdir -p "$INSTALL_DIR"

# Copy binary
cp "$HELPER_DIR/target/release/$BINARY_NAME" "$INSTALL_DIR/"

# Set ownership to root (required for capabilities to work properly)
chown root:root "$INSTALL_DIR/$BINARY_NAME"

# Set permissions: executable by all, writable only by root
chmod 755 "$INSTALL_DIR/$BINARY_NAME"

# Set CAP_NET_ADMIN capability
echo "Setting capabilities..."
setcap cap_net_admin+ep "$INSTALL_DIR/$BINARY_NAME"

# Verify capability was set
if ! getcap "$INSTALL_DIR/$BINARY_NAME" | grep -q "cap_net_admin"; then
    echo -e "${RED}Error: Failed to set capability${NC}"
    exit 1
fi

echo -e "${GREEN}Capability set successfully${NC}"

# Create symlink in PATH
if [ ! -L "/usr/local/bin/$BINARY_NAME" ]; then
    ln -sf "$INSTALL_DIR/$BINARY_NAME" "/usr/local/bin/$BINARY_NAME"
    echo "Created symlink: /usr/local/bin/$BINARY_NAME"
fi

# Verify installation
echo ""
echo "Verifying installation..."
"/usr/local/bin/$BINARY_NAME" check-caps
echo ""

# Setup bridge if requested
if [ "$SETUP_BRIDGE" = true ]; then
    echo "Setting up network bridge..."

    # Use the helper to create the bridge
    "/usr/local/bin/$BINARY_NAME" setup-bridge --name "$BRIDGE_NAME" --ip "$BRIDGE_IP"

    # Enable IP forwarding (use sysctl.d for clean uninstall)
    echo "Enabling IP forwarding..."
    sysctl -w net.ipv4.ip_forward=1 > /dev/null
    SYSCTL_FILE="/etc/sysctl.d/99-handler.conf"
    if [ ! -f "$SYSCTL_FILE" ]; then
        cat > "$SYSCTL_FILE" << 'SYSCTL_EOF'
# Handler VM networking - enable IP forwarding
net.ipv4.ip_forward=1
SYSCTL_EOF
        echo "Created $SYSCTL_FILE"
    fi

    # Setup NAT with nftables
    echo "Configuring NAT rules..."

    # Get default interface
    DEFAULT_IF=$(ip route | grep default | awk '{print $5}' | head -1)

    if command -v nft &> /dev/null; then
        # Use nftables
        nft delete table ip handler 2>/dev/null || true
        nft add table ip handler
        nft add chain ip handler postrouting "{ type nat hook postrouting priority 100 ; }"
        nft add rule ip handler postrouting ip saddr "$BRIDGE_SUBNET" oifname != "$BRIDGE_NAME" masquerade
        nft add chain ip handler forward "{ type filter hook forward priority 0 ; policy accept ; }"
        nft add rule ip handler forward iifname "$BRIDGE_NAME" accept
        nft add rule ip handler forward oifname "$BRIDGE_NAME" ct state established,related accept
        echo -e "${GREEN}NAT configured with nftables${NC}"
    elif command -v iptables &> /dev/null; then
        # Fallback to iptables
        iptables -t nat -A POSTROUTING -s "$BRIDGE_SUBNET" -o "$DEFAULT_IF" -j MASQUERADE
        iptables -A FORWARD -i "$BRIDGE_NAME" -j ACCEPT
        iptables -A FORWARD -o "$BRIDGE_NAME" -m state --state ESTABLISHED,RELATED -j ACCEPT
        echo -e "${GREEN}NAT configured with iptables${NC}"
    else
        echo -e "${YELLOW}Warning: Neither nftables nor iptables found. NAT not configured.${NC}"
    fi

    # Create systemd service for persistence (bridge + NAT rules)
    cat > /etc/systemd/system/handler-bridge.service << EOF
[Unit]
Description=Handler Network Bridge and NAT
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/$BINARY_NAME setup-bridge --name $BRIDGE_NAME --ip $BRIDGE_IP
ExecStart=/usr/sbin/nft -f /etc/handler-nat.conf
ExecStop=/usr/sbin/nft delete table ip handler
ExecStop=/sbin/ip link delete $BRIDGE_NAME

[Install]
WantedBy=multi-user.target
EOF

    # Save nftables rules to a config file for persistence
    cat > /etc/handler-nat.conf << NATEOF
table ip handler {
    chain postrouting {
        type nat hook postrouting priority 100 ; policy accept ;
        ip saddr $BRIDGE_SUBNET oifname != "$BRIDGE_NAME" masquerade
    }
    chain forward {
        type filter hook forward priority 0 ; policy accept ;
        iifname "$BRIDGE_NAME" accept
        oifname "$BRIDGE_NAME" ct state established,related accept
    }
}
NATEOF

    systemctl daemon-reload
    systemctl enable handler-bridge.service
    echo -e "${GREEN}Systemd service created and enabled${NC}"
fi

echo ""
echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}  Installation Complete!${NC}"
echo -e "${GREEN}======================================${NC}"
echo ""
echo "Installed: /usr/local/bin/$BINARY_NAME"
echo "Capability: CAP_NET_ADMIN"
echo ""
echo "Usage (no sudo required):"
echo "  $BINARY_NAME create --name tap0 --bridge $BRIDGE_NAME"
echo "  $BINARY_NAME delete --name tap0"
echo ""
if [ "$SETUP_BRIDGE" = false ]; then
    echo "To also setup bridge and NAT, run:"
    echo "  sudo $0 --setup-bridge"
    echo ""
fi
