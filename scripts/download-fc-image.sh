#!/bin/bash
# Download pre-built Firecracker image for Caisson
#
# This downloads a pre-built Ubuntu 24.04 image that's ready for Firecracker,
# with MMDS networking scripts already installed.
#
# Usage: ./scripts/download-fc-image.sh [options]
#
# Options:
#   --image NAME    Image to download (default: ubuntu-24.04)
#   --force         Re-download even if already exists
#   -h, --help      Show this help

set -e

# Configuration
BASE_URL="${CAISSON_IMAGE_URL:-https://caisson.dev.s3.us-east-2.amazonaws.com/images}"

# Handle sudo: use SUDO_USER's home if running as root via sudo
if [ -n "$SUDO_USER" ]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    REAL_HOME="$HOME"
fi

DATA_DIR="${CAISSON_DATA_DIR:-$REAL_HOME/.local/share/caisson}"
IMAGES_DIR="$DATA_DIR/base-images"

# Defaults
IMAGE_NAME="ubuntu-24.04"
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
    echo "Download pre-built Firecracker image for Caisson"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --image NAME    Image to download (default: ubuntu-24.04)"
    echo "  --force         Re-download even if already exists"
    echo "  -h, --help      Show this help"
    echo ""
    echo "Environment variables:"
    echo "  CAISSON_IMAGE_URL   Base URL for image downloads"
    echo "  CAISSON_DATA_DIR    Data directory (default: ~/.local/share/caisson)"
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --image)
            IMAGE_NAME="$2"
            shift 2
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

IMAGE_DIR="$IMAGES_DIR/$IMAGE_NAME"
IMAGE_URL="$BASE_URL/$IMAGE_NAME/firecracker"

echo "============================================"
echo "  Caisson Firecracker Image Downloader"
echo "============================================"
echo ""
echo "Image:       $IMAGE_NAME"
echo "Destination: $IMAGE_DIR"
echo "Source:      $IMAGE_URL"
echo ""

# Check if already exists
if [ -f "$IMAGE_DIR/rootfs.ext4" ] && [ -f "$IMAGE_DIR/vmlinux" ] && [ "$FORCE" != "true" ]; then
    log "Image already exists at $IMAGE_DIR"
    log "Use --force to re-download"
    exit 0
fi

# Create directory
mkdir -p "$IMAGE_DIR"

# Download manifest first
step "Downloading manifest..."
if ! curl -fsSL "$IMAGE_URL/manifest.json" -o "$IMAGE_DIR/manifest.json"; then
    error "Failed to download manifest from $IMAGE_URL/manifest.json"
fi

# Parse manifest for checksums using simple grep (avoid jq dependency)
ROOTFS_SHA256=$(grep -o '"sha256": "[^"]*"' "$IMAGE_DIR/manifest.json" | head -1 | cut -d'"' -f4)
KERNEL_SHA256=$(grep -o '"sha256": "[^"]*"' "$IMAGE_DIR/manifest.json" | tail -1 | cut -d'"' -f4)

# Download kernel
step "Downloading kernel (~43MB)..."
if [ -f "$IMAGE_DIR/vmlinux" ] && [ "$FORCE" != "true" ]; then
    log "Kernel already exists, verifying checksum..."
    if echo "$KERNEL_SHA256  $IMAGE_DIR/vmlinux" | sha256sum -c --quiet 2>/dev/null; then
        log "Kernel checksum OK, skipping download"
    else
        warn "Checksum mismatch, re-downloading..."
        curl -fL --progress-bar "$IMAGE_URL/vmlinux" -o "$IMAGE_DIR/vmlinux"
    fi
else
    curl -fL --progress-bar "$IMAGE_URL/vmlinux" -o "$IMAGE_DIR/vmlinux"
fi

# Verify kernel checksum
log "Verifying kernel checksum..."
if ! echo "$KERNEL_SHA256  $IMAGE_DIR/vmlinux" | sha256sum -c --quiet; then
    error "Kernel checksum verification failed!"
fi
log "Kernel checksum OK"

# Download rootfs (compressed)
step "Downloading rootfs (~415MB, this may take a few minutes)..."
ROOTFS_GZ="$IMAGE_DIR/rootfs.ext4.gz"
if [ -f "$ROOTFS_GZ" ] && [ "$FORCE" != "true" ]; then
    log "Compressed rootfs exists, verifying checksum..."
    if echo "$ROOTFS_SHA256  $ROOTFS_GZ" | sha256sum -c --quiet 2>/dev/null; then
        log "Rootfs checksum OK, skipping download"
    else
        warn "Checksum mismatch, re-downloading..."
        curl -fL --progress-bar "$IMAGE_URL/rootfs.ext4.gz" -o "$ROOTFS_GZ"
    fi
else
    curl -fL --progress-bar "$IMAGE_URL/rootfs.ext4.gz" -o "$ROOTFS_GZ"
fi

# Verify rootfs checksum
log "Verifying rootfs checksum..."
if ! echo "$ROOTFS_SHA256  $ROOTFS_GZ" | sha256sum -c --quiet; then
    error "Rootfs checksum verification failed!"
fi
log "Rootfs checksum OK"

# Decompress rootfs
step "Decompressing rootfs (~2.5GB)..."
if [ -f "$IMAGE_DIR/rootfs.ext4" ] && [ "$FORCE" != "true" ]; then
    log "Decompressed rootfs already exists"
else
    gunzip -c "$ROOTFS_GZ" > "$IMAGE_DIR/rootfs.ext4"
    log "Decompression complete"
fi

# Clean up compressed file to save space
rm -f "$ROOTFS_GZ"

# Set permissions
chmod 644 "$IMAGE_DIR/rootfs.ext4" "$IMAGE_DIR/vmlinux"

echo ""
echo "============================================"
echo -e "${GREEN}  Download Complete!${NC}"
echo "============================================"
echo ""
echo "Files:"
ls -lh "$IMAGE_DIR/"
echo ""
echo "The image is ready for use with Firecracker VMs."
