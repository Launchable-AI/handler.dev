#!/bin/bash
# Upload Firecracker image to Handler CDN (S3)
#
# This script uploads a prepared Firecracker image to the S3 bucket
# for distribution to users via the download-fc-image.sh script.
#
# Prerequisites:
#   1. AWS CLI configured with credentials that can write to the bucket
#   2. Image prepared with prepare-fc-image.sh (rootfs.ext4 + vmlinux exist)
#
# Usage: ./scripts/upload-fc-image.sh <image-name>
# Example: ./scripts/upload-fc-image.sh ubuntu-24.04
#
# What this script does:
#   1. Validates the local image files exist
#   2. Compresses rootfs.ext4 -> rootfs.ext4.gz (if not already compressed)
#   3. Generates SHA256 checksums for both files
#   4. Creates manifest.json with checksums and metadata
#   5. Uploads all files to S3
#
# S3 Structure:
#   s3://handler.dev-public/images/{IMAGE_NAME}/firecracker/
#     ├── manifest.json    # Checksums and metadata
#     ├── vmlinux          # Uncompressed kernel (~43MB)
#     └── rootfs.ext4.gz   # Compressed rootfs (~415MB)

set -e

# ============================================================================
# Configuration
# ============================================================================

S3_BUCKET="handler.dev-public"
S3_REGION="us-east-2"
S3_BASE_PATH="images"

# Local paths
if [ -n "$SUDO_USER" ]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
else
    REAL_HOME="$HOME"
fi
DATA_DIR="${HANDLER_DATA_DIR:-$REAL_HOME/.local/share/handler}"
BASE_IMAGES_DIR="$DATA_DIR/base-images"

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
cmd()   { echo -e "${CYAN}    \$ $*${NC}"; }

# ============================================================================
# Usage
# ============================================================================

usage() {
    echo "Upload Firecracker image to Handler CDN"
    echo ""
    echo "Usage: $0 <image-name> [--dry-run]"
    echo ""
    echo "Options:"
    echo "  --dry-run    Show commands without executing them"
    echo "  -h, --help   Show this help"
    echo ""
    echo "Example:"
    echo "  $0 ubuntu-24.04"
    echo ""
    echo "Prerequisites:"
    echo "  - AWS CLI configured: aws configure"
    echo "  - Image prepared: ./scripts/prepare-fc-image.sh <image-name>"
    exit 0
}

# ============================================================================
# Parse arguments
# ============================================================================

DRY_RUN=false
IMAGE_NAME=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        -*)
            error "Unknown option: $1"
            ;;
        *)
            IMAGE_NAME="$1"
            shift
            ;;
    esac
done

if [ -z "$IMAGE_NAME" ]; then
    usage
fi

# ============================================================================
# Paths
# ============================================================================

IMAGE_DIR="$BASE_IMAGES_DIR/$IMAGE_NAME"
ROOTFS_PATH="$IMAGE_DIR/rootfs.ext4"
ROOTFS_GZ_PATH="$IMAGE_DIR/rootfs.ext4.gz"
KERNEL_PATH="$IMAGE_DIR/vmlinux"
MANIFEST_PATH="$IMAGE_DIR/manifest.json"

S3_DEST="s3://$S3_BUCKET/$S3_BASE_PATH/$IMAGE_NAME/firecracker"

# ============================================================================
# Main
# ============================================================================

echo "============================================"
echo "  Handler Firecracker Image Uploader"
echo "============================================"
echo ""
echo "Image:       $IMAGE_NAME"
echo "Source:      $IMAGE_DIR"
echo "Destination: $S3_DEST"
echo "Dry run:     $DRY_RUN"
echo ""

# ----------------------------------------------------------------------------
# Step 1: Validate local files exist
# ----------------------------------------------------------------------------

step "Step 1: Validating local files"

if [ ! -f "$ROOTFS_PATH" ]; then
    error "Rootfs not found: $ROOTFS_PATH

Run prepare-fc-image.sh first:
    ./scripts/prepare-fc-image.sh $IMAGE_NAME"
fi
log "Found rootfs: $ROOTFS_PATH ($(du -h "$ROOTFS_PATH" | cut -f1))"

if [ ! -f "$KERNEL_PATH" ]; then
    error "Kernel not found: $KERNEL_PATH

Run prepare-fc-image.sh first:
    ./scripts/prepare-fc-image.sh $IMAGE_NAME"
fi
log "Found kernel: $KERNEL_PATH ($(du -h "$KERNEL_PATH" | cut -f1))"

# ----------------------------------------------------------------------------
# Step 2: Compress rootfs (if not already compressed)
# ----------------------------------------------------------------------------

step "Step 2: Compressing rootfs"

if [ -f "$ROOTFS_GZ_PATH" ]; then
    log "Compressed rootfs already exists: $ROOTFS_GZ_PATH"
    log "Delete it first if you want to recompress"
else
    log "Compressing rootfs.ext4 -> rootfs.ext4.gz"
    log "This may take a few minutes..."
    cmd "gzip -k -9 \"$ROOTFS_PATH\""

    if [ "$DRY_RUN" = false ]; then
        gzip -k -9 "$ROOTFS_PATH"
        log "Compression complete: $(du -h "$ROOTFS_GZ_PATH" | cut -f1)"
    fi
fi

# ----------------------------------------------------------------------------
# Step 3: Generate SHA256 checksums
# ----------------------------------------------------------------------------

step "Step 3: Generating SHA256 checksums"

cmd "sha256sum \"$ROOTFS_GZ_PATH\""
cmd "sha256sum \"$KERNEL_PATH\""

if [ "$DRY_RUN" = false ]; then
    ROOTFS_SHA256=$(sha256sum "$ROOTFS_GZ_PATH" | cut -d' ' -f1)
    KERNEL_SHA256=$(sha256sum "$KERNEL_PATH" | cut -d' ' -f1)

    log "Rootfs SHA256: $ROOTFS_SHA256"
    log "Kernel SHA256: $KERNEL_SHA256"
else
    ROOTFS_SHA256="<rootfs-sha256-placeholder>"
    KERNEL_SHA256="<kernel-sha256-placeholder>"
fi

# ----------------------------------------------------------------------------
# Step 4: Create manifest.json
# ----------------------------------------------------------------------------

step "Step 4: Creating manifest.json"

MANIFEST_CONTENT=$(cat <<EOF
{
  "name": "$IMAGE_NAME",
  "type": "firecracker",
  "version": "1.0",
  "created": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "files": {
    "rootfs": {
      "filename": "rootfs.ext4.gz",
      "sha256": "$ROOTFS_SHA256",
      "compressed": true
    },
    "kernel": {
      "filename": "vmlinux",
      "sha256": "$KERNEL_SHA256"
    }
  }
}
EOF
)

log "Manifest content:"
echo "$MANIFEST_CONTENT" | sed 's/^/    /'

cmd "echo '<manifest>' > \"$MANIFEST_PATH\""

if [ "$DRY_RUN" = false ]; then
    echo "$MANIFEST_CONTENT" > "$MANIFEST_PATH"
    log "Manifest written to: $MANIFEST_PATH"
fi

# ----------------------------------------------------------------------------
# Step 5: Upload to S3
# ----------------------------------------------------------------------------

step "Step 5: Uploading to S3"

log "Uploading manifest.json..."
cmd "aws s3 cp \"$MANIFEST_PATH\" \"$S3_DEST/manifest.json\" --region $S3_REGION"

if [ "$DRY_RUN" = false ]; then
    aws s3 cp "$MANIFEST_PATH" "$S3_DEST/manifest.json" --region $S3_REGION
fi

log "Uploading kernel (~43MB)..."
cmd "aws s3 cp \"$KERNEL_PATH\" \"$S3_DEST/vmlinux\" --region $S3_REGION"

if [ "$DRY_RUN" = false ]; then
    aws s3 cp "$KERNEL_PATH" "$S3_DEST/vmlinux" --region $S3_REGION
fi

log "Uploading rootfs (~415MB, this may take a while)..."
cmd "aws s3 cp \"$ROOTFS_GZ_PATH\" \"$S3_DEST/rootfs.ext4.gz\" --region $S3_REGION"

if [ "$DRY_RUN" = false ]; then
    aws s3 cp "$ROOTFS_GZ_PATH" "$S3_DEST/rootfs.ext4.gz" --region $S3_REGION
fi

# ----------------------------------------------------------------------------
# Done
# ----------------------------------------------------------------------------

echo ""
echo "============================================"
if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}  Dry Run Complete (no changes made)${NC}"
else
    echo -e "${GREEN}  Upload Complete!${NC}"
fi
echo "============================================"
echo ""
echo "Files uploaded to:"
echo "  $S3_DEST/"
echo ""
echo "Public URL:"
echo "  https://s3.$S3_REGION.amazonaws.com/$S3_BUCKET/$S3_BASE_PATH/$IMAGE_NAME/firecracker/"
echo ""
echo "Verify with:"
cmd "aws s3 ls $S3_DEST/ --region $S3_REGION"
echo ""
echo "Users can download with:"
echo "  ./scripts/download-fc-image.sh --image $IMAGE_NAME"
echo ""
