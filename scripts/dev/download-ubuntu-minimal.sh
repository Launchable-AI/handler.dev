#!/bin/bash
# Download and set up Ubuntu Minimal cloud image for VMs
set -e

# Handle data directory: prefer explicit env var, then check for sudo context
if [ -n "$HANDLER_DATA_DIR" ]; then
    DATA_DIR="$HANDLER_DATA_DIR"
elif [ -n "$SUDO_USER" ]; then
    REAL_HOME=$(getent passwd "$SUDO_USER" | cut -d: -f6)
    DATA_DIR="$REAL_HOME/.local/share/handler"
else
    DATA_DIR="${HOME}/.local/share/handler"
fi

BASE_IMAGES_DIR="$DATA_DIR/base-images"
IMAGE_NAME="ubuntu-minimal-24.04"
IMAGE_DIR="${BASE_IMAGES_DIR}/${IMAGE_NAME}"

# Ubuntu minimal cloud image URL
IMAGE_URL="https://cloud-images.ubuntu.com/minimal/releases/noble/release/ubuntu-24.04-minimal-cloudimg-amd64.img"

echo "Setting up Ubuntu Minimal 24.04 base image..."

# Create directory
mkdir -p "${IMAGE_DIR}"

# Download image if not exists
if [ ! -f "${IMAGE_DIR}/image.qcow2" ]; then
    echo "Downloading Ubuntu Minimal cloud image..."
    wget -q --show-progress "${IMAGE_URL}" -O "${IMAGE_DIR}/image.qcow2.tmp"
    mv "${IMAGE_DIR}/image.qcow2.tmp" "${IMAGE_DIR}/image.qcow2"
    echo "Download complete."
else
    echo "Image already exists, skipping download."
fi

# Cloud-hypervisor can boot QCOW2 images directly using the image's bootloader,
# so kernel/initrd extraction is optional. We'll try to extract them for direct
# kernel boot (faster startup) but won't fail if we can't.
echo "Attempting to extract kernel and initrd..."

# Check if kernel/initrd already exist
if [ -f "${IMAGE_DIR}/kernel" ] && [ -f "${IMAGE_DIR}/initrd" ]; then
    echo "Kernel and initrd already extracted."
else
    EXTRACTION_FAILED=false

    # Create a temporary mount point
    MOUNT_DIR=$(mktemp -d)
    NBD_DEVICE=""

    cleanup() {
        if [ -n "$NBD_DEVICE" ]; then
            sudo umount "${MOUNT_DIR}" 2>/dev/null || true
            sudo qemu-nbd --disconnect "$NBD_DEVICE" 2>/dev/null || true
            echo "${NBD_DEVICE} disconnected"
        fi
        rmdir "${MOUNT_DIR}" 2>/dev/null || true
    }
    trap cleanup EXIT

    # Load nbd module
    if ! sudo modprobe nbd max_part=8 2>/dev/null; then
        echo "Warning: Could not load nbd module, skipping kernel extraction"
        EXTRACTION_FAILED=true
    fi

    if [ "$EXTRACTION_FAILED" = false ]; then
        # Find available nbd device
        for i in $(seq 0 15); do
            if [ ! -e /sys/block/nbd${i}/pid ]; then
                NBD_DEVICE="/dev/nbd${i}"
                break
            fi
        done

        if [ -z "$NBD_DEVICE" ]; then
            echo "Warning: No available NBD device found, skipping kernel extraction"
            EXTRACTION_FAILED=true
        fi
    fi

    if [ "$EXTRACTION_FAILED" = false ]; then
        echo "Using NBD device: ${NBD_DEVICE}"

        # Connect the QCOW2 image
        if ! sudo qemu-nbd --connect="${NBD_DEVICE}" "${IMAGE_DIR}/image.qcow2" 2>/dev/null; then
            echo "Warning: Could not connect NBD device, skipping kernel extraction"
            EXTRACTION_FAILED=true
        fi
    fi

    if [ "$EXTRACTION_FAILED" = false ]; then
        sleep 1

        # Wait for partitions to appear and find the root partition
        ROOT_PARTITION=""
        for i in $(seq 1 10); do
            # Try common partition layouts
            # GPT: p1 is usually EFI, p2 is usually root
            # MBR: p1 is usually root
            for part in "${NBD_DEVICE}p2" "${NBD_DEVICE}p1" "${NBD_DEVICE}p3"; do
                if [ -e "$part" ]; then
                    # Try to mount and check for /boot
                    if sudo mount "$part" "${MOUNT_DIR}" 2>/dev/null; then
                        if [ -d "${MOUNT_DIR}/boot" ]; then
                            ROOT_PARTITION="$part"
                            break 2
                        fi
                        sudo umount "${MOUNT_DIR}" 2>/dev/null || true
                    fi
                fi
            done
            sleep 0.5
        done

        if [ -z "$ROOT_PARTITION" ]; then
            echo "Warning: Could not find root partition, skipping kernel extraction"
            EXTRACTION_FAILED=true
        fi
    fi

    if [ "$EXTRACTION_FAILED" = false ]; then
        # Copy kernel and initrd
        KERNEL=$(ls "${MOUNT_DIR}/boot/vmlinuz-"* 2>/dev/null | sort -V | tail -1)
        INITRD=$(ls "${MOUNT_DIR}/boot/initrd.img-"* 2>/dev/null | sort -V | tail -1)

        if [ -z "$KERNEL" ] || [ -z "$INITRD" ]; then
            echo "Warning: Could not find kernel or initrd in image"
            EXTRACTION_FAILED=true
        else
            echo "Found kernel: ${KERNEL}"
            echo "Found initrd: ${INITRD}"

            sudo cp "${KERNEL}" "${IMAGE_DIR}/kernel"
            sudo cp "${INITRD}" "${IMAGE_DIR}/initrd"
            sudo chown $(id -u):$(id -g) "${IMAGE_DIR}/kernel" "${IMAGE_DIR}/initrd"
            echo "Kernel and initrd extracted successfully."
        fi

        # Cleanup
        sudo umount "${MOUNT_DIR}" 2>/dev/null || true
    fi

    if [ -n "$NBD_DEVICE" ]; then
        sudo qemu-nbd --disconnect "${NBD_DEVICE}" 2>/dev/null || true
        NBD_DEVICE=""
    fi

    if [ "$EXTRACTION_FAILED" = true ]; then
        echo ""
        echo "Note: Kernel/initrd extraction skipped. Cloud-hypervisor will boot"
        echo "      the image using its built-in bootloader (slightly slower startup)."
    fi
fi

# Resize image to ensure it has enough space for QCOW2 overlays
echo "Ensuring image has minimum size for overlays..."
CURRENT_SIZE=$(qemu-img info --output=json "${IMAGE_DIR}/image.qcow2" | grep '"virtual-size"' | grep -oP '\d+')
MIN_SIZE=$((10 * 1024 * 1024 * 1024)) # 10GB

if [ "$CURRENT_SIZE" -lt "$MIN_SIZE" ]; then
    echo "Resizing image to 10GB..."
    qemu-img resize "${IMAGE_DIR}/image.qcow2" 10G
fi

echo ""
echo "Ubuntu Minimal 24.04 setup complete!"
echo "Location: ${IMAGE_DIR}"
echo ""
echo "Files:"
ls -lh "${IMAGE_DIR}/"
echo ""
echo "To use this image, it will be available in the Base Images section of the UI."
