#!/bin/bash
# Build a Docker-capable Firecracker kernel
#
# This script builds a custom Linux kernel for Firecracker that includes
# full Docker support (iptables, nf_tables, overlay2, namespaces, cgroups)
# with all required options compiled as built-ins (=y), not modules (=m).
#
# Firecracker boots with 'nomodule' so =m options are effectively disabled.
#
# Usage: ./scripts/dev/build-fc-kernel.sh [options]
#
# Options:
#   --kernel-version VER   Linux kernel version (default: 6.1.112)
#   --output PATH          Output vmlinux path (default: ./vmlinux)
#   --jobs N               Parallel build jobs (default: nproc)
#   --config-only          Generate .config but don't build
#   -h, --help             Show this help
#
# Prerequisites:
#   - Build tools: gcc, make, flex, bison, libelf-dev, libssl-dev, bc
#   - ~2GB disk space for kernel source + build artifacts
#   - ~10-20 minutes build time depending on CPU
#
# References:
#   - Firecracker kernel policy: https://github.com/firecracker-microvm/firecracker/blob/main/docs/kernel-policy.md
#   - Firecracker CI configs: https://github.com/firecracker-microvm/firecracker/tree/main/resources/guest_configs
#   - Docker check-config.sh: https://github.com/moby/moby/blob/master/contrib/check-config.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ============================================================================
# Configuration
# ============================================================================

KERNEL_VERSION="${KERNEL_VERSION:-6.1.112}"
KERNEL_MAJOR=$(echo "$KERNEL_VERSION" | cut -d. -f1,2)  # e.g., 6.1
FC_CONFIG_URL="https://raw.githubusercontent.com/firecracker-microvm/firecracker/main/resources/guest_configs/microvm-kernel-ci-x86_64-${KERNEL_MAJOR}.config"
KERNEL_URL="https://cdn.kernel.org/pub/linux/kernel/v${KERNEL_VERSION%%.*}.x/linux-${KERNEL_VERSION}.tar.xz"

OUTPUT_PATH=""
JOBS=$(nproc 2>/dev/null || echo 4)
CONFIG_ONLY=false
BUILD_DIR="${BUILD_DIR:-/tmp/handler-kernel-build}"

# ============================================================================
# Colors and logging
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()  { echo -e "\n${BLUE}==>${NC} $*"; }

# ============================================================================
# Usage
# ============================================================================

usage() {
    echo "Build a Docker-capable Firecracker kernel"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --kernel-version VER   Linux kernel version (default: $KERNEL_VERSION)"
    echo "  --output PATH          Output vmlinux path (default: <base-images-dir>/<image>/vmlinux)"
    echo "  --jobs N               Parallel build jobs (default: $JOBS)"
    echo "  --config-only          Generate .config but don't build"
    echo "  --build-dir DIR        Build directory (default: $BUILD_DIR)"
    echo "  -h, --help             Show this help"
    echo ""
    echo "Prerequisites:"
    echo "  Ubuntu/Debian: sudo apt install build-essential flex bison libelf-dev libssl-dev bc"
    echo "  Fedora:        sudo dnf install gcc make flex bison elfutils-libelf-devel openssl-devel bc"
    echo ""
    echo "The kernel is based on Firecracker's CI config with Docker support added:"
    echo "  - Full iptables/netfilter stack (no --iptables=false needed)"
    echo "  - overlay2 filesystem support"
    echo "  - All options as =y (built-in), not =m (module)"
    exit 0
}

# ============================================================================
# Parse arguments
# ============================================================================

while [[ $# -gt 0 ]]; do
    case $1 in
        --kernel-version)
            KERNEL_VERSION="$2"
            KERNEL_MAJOR=$(echo "$KERNEL_VERSION" | cut -d. -f1,2)
            KERNEL_URL="https://cdn.kernel.org/pub/linux/kernel/v${KERNEL_VERSION%%.*}.x/linux-${KERNEL_VERSION}.tar.xz"
            FC_CONFIG_URL="https://raw.githubusercontent.com/firecracker-microvm/firecracker/main/resources/guest_configs/microvm-kernel-ci-x86_64-${KERNEL_MAJOR}.config"
            shift 2
            ;;
        --output)
            OUTPUT_PATH="$2"
            shift 2
            ;;
        --jobs)
            JOBS="$2"
            shift 2
            ;;
        --config-only)
            CONFIG_ONLY=true
            shift
            ;;
        --build-dir)
            BUILD_DIR="$2"
            shift 2
            ;;
        -h|--help)
            usage
            ;;
        *)
            error "Unknown option: $1"
            ;;
    esac
done

# Default output path
if [ -z "$OUTPUT_PATH" ]; then
    OUTPUT_PATH="$BUILD_DIR/vmlinux"
fi

echo "============================================"
echo "  Handler Firecracker Kernel Builder"
echo "============================================"
echo ""
echo "Kernel version: $KERNEL_VERSION"
echo "Build dir:      $BUILD_DIR"
echo "Output:         $OUTPUT_PATH"
echo "Parallel jobs:  $JOBS"
echo ""

# ============================================================================
# Step 1: Check prerequisites
# ============================================================================

step "Step 1: Checking build prerequisites"

MISSING=()
command -v gcc     &>/dev/null || MISSING+=("gcc (build-essential)")
command -v make    &>/dev/null || MISSING+=("make")
command -v flex    &>/dev/null || MISSING+=("flex")
command -v bison   &>/dev/null || MISSING+=("bison")
command -v bc      &>/dev/null || MISSING+=("bc")

# Check for libelf headers
if ! echo '#include <gelf.h>' | gcc -xc - -c -o /dev/null 2>/dev/null; then
    MISSING+=("libelf-dev (elfutils-libelf-devel)")
fi

# Check for openssl headers
if ! echo '#include <openssl/bio.h>' | gcc -xc - -c -o /dev/null 2>/dev/null; then
    MISSING+=("libssl-dev (openssl-devel)")
fi

if [ ${#MISSING[@]} -gt 0 ]; then
    error "Missing build dependencies: ${MISSING[*]}

Install on Ubuntu/Debian:
  sudo apt install build-essential flex bison libelf-dev libssl-dev bc

Install on Fedora:
  sudo dnf install gcc make flex bison elfutils-libelf-devel openssl-devel bc"
fi

log "All prerequisites OK"

# ============================================================================
# Step 2: Download kernel source
# ============================================================================

step "Step 2: Downloading kernel source"

mkdir -p "$BUILD_DIR"
KERNEL_SRC="$BUILD_DIR/linux-${KERNEL_VERSION}"

if [ -d "$KERNEL_SRC" ]; then
    log "Kernel source already exists at $KERNEL_SRC"
else
    KERNEL_TAR="$BUILD_DIR/linux-${KERNEL_VERSION}.tar.xz"
    if [ -f "$KERNEL_TAR" ]; then
        log "Kernel tarball already downloaded"
    else
        log "Downloading Linux ${KERNEL_VERSION}..."
        curl -fL --progress-bar -o "$KERNEL_TAR" "$KERNEL_URL" || \
            error "Failed to download kernel from $KERNEL_URL"
    fi

    log "Extracting kernel source..."
    tar -xf "$KERNEL_TAR" -C "$BUILD_DIR"
    log "Kernel source ready at $KERNEL_SRC"
fi

# ============================================================================
# Step 3: Download Firecracker base config
# ============================================================================

step "Step 3: Downloading Firecracker base kernel config"

FC_BASE_CONFIG="$BUILD_DIR/firecracker-base.config"

if [ -f "$FC_BASE_CONFIG" ]; then
    log "Firecracker config already downloaded"
else
    log "Downloading Firecracker ${KERNEL_MAJOR} CI config..."
    curl -fsSL -o "$FC_BASE_CONFIG" "$FC_CONFIG_URL" || \
        error "Failed to download Firecracker config from $FC_CONFIG_URL"
    log "Config downloaded"
fi

# ============================================================================
# Step 4: Create Docker config fragment
# ============================================================================

step "Step 4: Creating Docker kernel config fragment"

DOCKER_CONFIG="$BUILD_DIR/docker-support.config"

cat > "$DOCKER_CONFIG" << 'EOF'
# =============================================================================
# Docker-in-Firecracker kernel config fragment
#
# All options set to =y (built-in) because Firecracker boots with 'nomodule'.
# This fragment is merged on top of Firecracker's CI config.
# =============================================================================

# --- Overlay filesystem (Docker overlay2 storage driver) ---
CONFIG_OVERLAY_FS=y
# Redirect dir allows efficient directory renames across layers
CONFIG_OVERLAY_FS_REDIRECT_DIR=y
CONFIG_OVERLAY_FS_REDIRECT_ALWAYS_FOLLOW=y
# Index enables NFS-stable file handles (needed for some Docker operations)
CONFIG_OVERLAY_FS_INDEX=y
# Metacopy enables metadata-only copy-up (faster layer operations)
CONFIG_OVERLAY_FS_METACOPY=y

# --- Netfilter / iptables (Docker networking) ---
CONFIG_NETFILTER=y
CONFIG_NETFILTER_ADVANCED=y
CONFIG_NETFILTER_XTABLES=y

# Connection tracking (required for NAT and masquerading)
CONFIG_NF_CONNTRACK=y
CONFIG_NF_CONNTRACK_FTP=y
CONFIG_NF_CONNTRACK_TFTP=y

# NAT support
CONFIG_NF_NAT=y
CONFIG_NF_NAT_MASQUERADE=y

# nf_tables (required by iptables-nft, the default on Ubuntu 22.04+)
# Without these, Docker fails with "Error initializing network controller"
# because iptables-nft calls into the nf_tables kernel API
CONFIG_NF_TABLES=y
CONFIG_NF_TABLES_INET=y
CONFIG_NF_TABLES_NETDEV=y
CONFIG_NFT_NUMGEN=y
CONFIG_NFT_CT=y
CONFIG_NFT_COUNTER=y
CONFIG_NFT_CONNLIMIT=y
CONFIG_NFT_LOG=y
CONFIG_NFT_LIMIT=y
CONFIG_NFT_MASQ=y
CONFIG_NFT_REDIR=y
CONFIG_NFT_NAT=y
CONFIG_NFT_REJECT=y
CONFIG_NFT_HASH=y
CONFIG_NFT_FIB=y
CONFIG_NFT_FIB_INET=y
CONFIG_NFT_FIB_IPV4=y
CONFIG_NFT_FIB_IPV6=y
# iptables-nft compatibility layer (translates iptables rules to nf_tables)
CONFIG_NFT_COMPAT=y

# IPv4 iptables (legacy x_tables — kept as fallback)
CONFIG_IP_NF_IPTABLES=y
CONFIG_IP_NF_FILTER=y
CONFIG_IP_NF_NAT=y
CONFIG_IP_NF_TARGET_MASQUERADE=y
CONFIG_IP_NF_MANGLE=y
CONFIG_IP_NF_RAW=y

# IPv6 iptables
CONFIG_IP6_NF_IPTABLES=y
CONFIG_IP6_NF_FILTER=y
CONFIG_IP6_NF_NAT=y
CONFIG_IP6_NF_TARGET_MASQUERADE=y
CONFIG_IP6_NF_MANGLE=y
CONFIG_IP6_NF_RAW=y

# Netfilter match extensions (Docker uses many of these)
CONFIG_NETFILTER_XT_TARGET_MASQUERADE=y
CONFIG_NETFILTER_XT_MATCH_ADDRTYPE=y
CONFIG_NETFILTER_XT_MATCH_CONNTRACK=y
CONFIG_NETFILTER_XT_MATCH_COMMENT=y
CONFIG_NETFILTER_XT_MATCH_MULTIPORT=y
CONFIG_NETFILTER_XT_MATCH_MARK=y
CONFIG_NETFILTER_XT_MATCH_IPVS=y
CONFIG_NETFILTER_XT_MATCH_STATISTIC=y
CONFIG_NETFILTER_XT_MATCH_LIMIT=y
CONFIG_NETFILTER_XT_MATCH_RECENT=y
CONFIG_NETFILTER_XT_MATCH_STATE=y
CONFIG_NETFILTER_XT_TARGET_REDIRECT=y
CONFIG_NETFILTER_XT_TARGET_MARK=y

# --- Virtual networking (container networking) ---
CONFIG_VETH=y
CONFIG_BRIDGE=y
CONFIG_BRIDGE_NETFILTER=y
CONFIG_BRIDGE_IGMP_SNOOPING=y
CONFIG_NET_SCH_FQ_CODEL=y

# --- Namespaces (container isolation) ---
CONFIG_NAMESPACES=y
CONFIG_NET_NS=y
CONFIG_PID_NS=y
CONFIG_IPC_NS=y
CONFIG_UTS_NS=y
CONFIG_USER_NS=y
CONFIG_CGROUP_NS=y

# --- Cgroups (resource limits) ---
CONFIG_CGROUPS=y
CONFIG_CGROUP_DEVICE=y
CONFIG_CGROUP_FREEZER=y
CONFIG_CGROUP_PIDS=y
CONFIG_CGROUP_SCHED=y
CONFIG_CGROUP_CPUACCT=y
CONFIG_CPUSETS=y
CONFIG_MEMCG=y
CONFIG_BLK_CGROUP=y

# --- Security ---
CONFIG_SECCOMP=y
CONFIG_SECCOMP_FILTER=y
CONFIG_KEYS=y

# --- PCI support (required for ACPI initialization) ---
# Firecracker doesn't expose PCI devices, but CONFIG_PCI is required because
# Firecracker unconditionally generates an MCFG ACPI table. Without CONFIG_PCI,
# the kernel has no handler for PCI config space ACPI operation regions, causing
# "AE_BAD_PARAMETER During Region initialization" which breaks DSDT processing
# and cascades into virtio IRQ allocation failures (error -22).
# See: https://github.com/firecracker-microvm/firecracker/blob/main/docs/kernel-policy.md
CONFIG_PCI=y
CONFIG_PCI_MMCONFIG=y

# --- ACPI-based device and CPU discovery (Firecracker >= v1.8) ---
# Firecracker v1.8+ provides proper ACPI tables (MADT for vCPU discovery,
# DSDT for virtio-mmio device discovery). Boot WITHOUT acpi=off.
# CMDLINE_DEVICES kept as fallback for legacy compatibility.
CONFIG_VIRTIO_MMIO_CMDLINE_DEVICES=y

# --- Misc (Docker runtime) ---
CONFIG_AUTOFS4_FS=y
CONFIG_FHANDLE=y
CONFIG_POSIX_MQUEUE=y
CONFIG_DEVPTS_MULTIPLE_INSTANCES=y
EOF

log "Docker config fragment written to $DOCKER_CONFIG"

# ============================================================================
# Step 5: Merge configs and prepare for build
# ============================================================================

step "Step 5: Merging configs"

cd "$KERNEL_SRC"

# Copy Firecracker base config
cp "$FC_BASE_CONFIG" .config

# Use kernel's merge script to overlay Docker fragment
# This preserves all Firecracker options and only changes/adds Docker options
if [ -f scripts/kconfig/merge_config.sh ]; then
    KCONFIG_CONFIG=.config ./scripts/kconfig/merge_config.sh -m .config "$DOCKER_CONFIG"
else
    # Fallback: manual merge by appending and running olddefconfig
    cat "$DOCKER_CONFIG" >> .config
fi

# Resolve any dependency issues and set unset options to defaults
make olddefconfig

log "Config merge complete"

# Verify critical options are set
step "Verifying critical Docker options"

VERIFY_OPTS=(
    CONFIG_OVERLAY_FS
    CONFIG_NF_CONNTRACK
    CONFIG_NF_NAT
    CONFIG_NF_TABLES
    CONFIG_NFT_NAT
    CONFIG_NFT_MASQ
    CONFIG_NFT_COMPAT
    CONFIG_IP_NF_IPTABLES
    CONFIG_IP_NF_NAT
    CONFIG_IP_NF_TARGET_MASQUERADE
    CONFIG_VETH
    CONFIG_BRIDGE
    CONFIG_BRIDGE_NETFILTER
    CONFIG_NAMESPACES
    CONFIG_SECCOMP
)

ALL_OK=true
for opt in "${VERIFY_OPTS[@]}"; do
    val=$(grep "^${opt}=" .config 2>/dev/null | head -1)
    if [ -z "$val" ]; then
        warn "$opt: NOT SET"
        ALL_OK=false
    elif echo "$val" | grep -q "=m$"; then
        warn "$opt: set to =m (module) — should be =y for Firecracker"
        ALL_OK=false
    else
        log "$opt: OK ($val)"
    fi
done

if [ "$ALL_OK" = false ]; then
    warn "Some options are not correctly set. The build may produce a kernel that doesn't fully support Docker."
fi

if [ "$CONFIG_ONLY" = true ]; then
    cp .config "$BUILD_DIR/handler-fc-kernel.config"
    echo ""
    echo "Config-only mode: config written to $BUILD_DIR/handler-fc-kernel.config"
    echo "To build manually:"
    echo "  cd $KERNEL_SRC"
    echo "  make -j$JOBS vmlinux"
    exit 0
fi

# ============================================================================
# Step 6: Build kernel
# ============================================================================

step "Step 6: Building kernel (this will take 10-20 minutes)"

log "Building with $JOBS parallel jobs..."
make -j"$JOBS" vmlinux

if [ ! -f vmlinux ]; then
    error "Build failed: vmlinux not found"
fi

KERNEL_SIZE=$(du -h vmlinux | cut -f1)
log "Build complete: vmlinux ($KERNEL_SIZE)"

# ============================================================================
# Step 7: Copy output
# ============================================================================

step "Step 7: Copying kernel to output"

mkdir -p "$(dirname "$OUTPUT_PATH")"
cp vmlinux "$OUTPUT_PATH"
chmod 644 "$OUTPUT_PATH"

log "Kernel copied to: $OUTPUT_PATH"

# ============================================================================
# Step 8: Verify with Docker check-config (optional)
# ============================================================================

step "Step 8: Quick Docker compatibility check"

# Check a few critical options from the built config
KCONFIG=".config"
DOCKER_CHECKS=(
    "CONFIG_OVERLAY_FS=y:overlay2 storage"
    "CONFIG_NF_TABLES=y:nf_tables (iptables-nft)"
    "CONFIG_NFT_COMPAT=y:iptables-nft compat"
    "CONFIG_IP_NF_NAT=y:iptables NAT"
    "CONFIG_VETH=y:container networking"
    "CONFIG_BRIDGE=y:bridge networking"
    "CONFIG_NAMESPACES=y:container isolation"
    "CONFIG_MEMCG=y:memory cgroups"
)

echo ""
for check in "${DOCKER_CHECKS[@]}"; do
    opt="${check%%:*}"
    desc="${check##*:}"
    if grep -q "^$opt" "$KCONFIG"; then
        echo -e "  ${GREEN}✓${NC} $desc ($opt)"
    else
        echo -e "  ${RED}✗${NC} $desc ($opt)"
    fi
done

# ============================================================================
# Done
# ============================================================================

echo ""
echo "============================================"
echo -e "${GREEN}  Kernel Build Complete!${NC}"
echo "============================================"
echo ""
echo "Output:  $OUTPUT_PATH"
echo "Size:    $KERNEL_SIZE"
echo "Version: $KERNEL_VERSION"
echo ""
echo "To use this kernel with Firecracker:"
echo "  1. Copy to your base images directory:"
echo "     cp $OUTPUT_PATH ~/.local/share/handler/base-images/ubuntu-24.04/vmlinux"
echo ""
echo "  2. The kernel supports full Docker (overlay2 + iptables)."
echo "     No --iptables=false or --storage-driver=vfs workarounds needed"
echo "     when Docker's /var/lib/docker is on a dedicated ext4 volume."
echo ""
echo "To verify Docker support:"
echo "  curl -fsSL https://raw.githubusercontent.com/moby/moby/master/contrib/check-config.sh | CONFIG=$KERNEL_SRC/.config bash"
echo ""
