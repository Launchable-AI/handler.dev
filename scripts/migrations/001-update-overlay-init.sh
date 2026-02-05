#!/bin/bash
# Migration 001: Update overlay-init to fix layered image support
#
# This is a ONE-TIME migration script for existing installations.
# New installations will get the fixed overlay-init via prepare-fc-image.sh.
#
# Problem: overlay-init was looking for files at /parent1/ but promoted
# snapshot layers store files at /parent1/upper/ (overlayfs structure).
#
# Run this script once to update existing base images.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
GUEST_INIT_DIR="$PROJECT_DIR/guest-init"

# Handle sudo: use SUDO_USER's home if running as root via sudo
if [ -n "$SUDO_USER" ]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    REAL_HOME="$HOME"
fi
BASE_IMAGES_DIR="${BASE_IMAGES_DIR:-$REAL_HOME/.local/share/caisson/base-images}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# Check for overlay-init source
if [ ! -f "$GUEST_INIT_DIR/overlay-init" ]; then
    error "overlay-init not found at $GUEST_INIT_DIR/overlay-init"
fi

# Check for base images directory
if [ ! -d "$BASE_IMAGES_DIR" ]; then
    error "Base images directory not found: $BASE_IMAGES_DIR"
fi

echo "=== Migration 001: Update overlay-init ==="
echo ""
echo "This will update the overlay-init script in all base images."
echo "Base images directory: $BASE_IMAGES_DIR"
echo ""

# Find all base images with rootfs.ext4
IMAGES=()
for dir in "$BASE_IMAGES_DIR"/*/; do
    if [ -f "${dir}rootfs.ext4" ]; then
        IMAGES+=("$(basename "$dir")")
    fi
done

if [ ${#IMAGES[@]} -eq 0 ]; then
    log "No base images found with rootfs.ext4"
    exit 0
fi

echo "Found ${#IMAGES[@]} base image(s): ${IMAGES[*]}"
echo ""

# Check if running as root (needed for mount method)
if [ "$EUID" -ne 0 ]; then
    # Try guestfish
    if ! command -v guestfish &> /dev/null; then
        error "This script requires either:\n  - Root privileges (sudo)\n  - guestfish installed (sudo apt install libguestfs-tools)"
    fi
    USE_GUESTFISH=1
else
    USE_GUESTFISH=0
    # Prefer guestfish even as root if available
    if command -v guestfish &> /dev/null; then
        USE_GUESTFISH=1
    fi
fi

update_image_guestfish() {
    local image_name="$1"
    local raw_path="$BASE_IMAGES_DIR/$image_name/rootfs.ext4"

    log "Updating $image_name using guestfish..."

    guestfish -a "$raw_path" <<EOF
run
mount /dev/sda1 /
upload $GUEST_INIT_DIR/overlay-init /sbin/overlay-init
chmod 0755 /sbin/overlay-init
EOF

    log "Updated $image_name"
}

update_image_mount() {
    local image_name="$1"
    local raw_path="$BASE_IMAGES_DIR/$image_name/rootfs.ext4"

    log "Updating $image_name using mount..."

    MOUNT_POINT=$(mktemp -d)

    # Find partition offset
    PART_INFO=$(fdisk -l "$raw_path" 2>/dev/null | grep "Linux filesystem" | head -1)
    if [ -z "$PART_INFO" ]; then
        PART_INFO=$(fdisk -l "$raw_path" 2>/dev/null | grep "${raw_path}.*1 " | head -1)
    fi

    if [ -n "$PART_INFO" ]; then
        OFFSET=$(echo "$PART_INFO" | awk '{print $2}')
        if [ "$OFFSET" = "*" ]; then
            OFFSET=$(echo "$PART_INFO" | awk '{print $3}')
        fi
        OFFSET_BYTES=$((OFFSET * 512))
    else
        OFFSET_BYTES=0
    fi

    LOOP_DEV=$(losetup -f --show -o "$OFFSET_BYTES" "$raw_path" 2>/dev/null)
    if [ -z "$LOOP_DEV" ]; then
        rmdir "$MOUNT_POINT"
        error "Failed to setup loop device for $image_name"
    fi

    trap "umount '$MOUNT_POINT' 2>/dev/null; losetup -d '$LOOP_DEV' 2>/dev/null; rmdir '$MOUNT_POINT' 2>/dev/null" RETURN

    mount "$LOOP_DEV" "$MOUNT_POINT" || {
        error "Failed to mount $image_name"
    }

    cp "$GUEST_INIT_DIR/overlay-init" "$MOUNT_POINT/sbin/overlay-init"
    chmod +x "$MOUNT_POINT/sbin/overlay-init"

    umount "$MOUNT_POINT"
    losetup -d "$LOOP_DEV"
    rmdir "$MOUNT_POINT"
    trap - RETURN

    log "Updated $image_name"
}

# Update each image
for image in "${IMAGES[@]}"; do
    if [ "$USE_GUESTFISH" = "1" ]; then
        update_image_guestfish "$image"
    else
        update_image_mount "$image"
    fi
done

echo ""
echo "=== Migration Complete ==="
echo ""
echo "Updated overlay-init in ${#IMAGES[@]} image(s)."
echo ""
echo "Next steps:"
echo "  1. Take a new snapshot from a VM"
echo "  2. Promote the snapshot to a base image"
echo "  3. Create a VM from the promoted image - it should now include your changes"
echo ""
