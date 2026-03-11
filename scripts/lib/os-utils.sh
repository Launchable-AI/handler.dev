#!/bin/bash
# OS detection and package management abstraction
#
# This library provides OS-agnostic package management functions.
# Currently supports: Ubuntu/Debian, Arch Linux
#
# Usage: source "$(dirname "${BASH_SOURCE[0]}")/lib/os-utils.sh"

# Detect the operating system
# Sets: OS_ID, OS_NAME, OS_VERSION, PKG_MANAGER
detect_os() {
    if [ -n "$OS_ID" ]; then
        return 0  # Already detected
    fi

    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS_ID="${ID:-unknown}"
        OS_NAME="${NAME:-unknown}"
        OS_VERSION="${VERSION_ID:-unknown}"
    elif [ -f /etc/arch-release ]; then
        OS_ID="arch"
        OS_NAME="Arch Linux"
        OS_VERSION="rolling"
    elif command -v lsb_release &> /dev/null; then
        OS_ID=$(lsb_release -si | tr '[:upper:]' '[:lower:]')
        OS_NAME=$(lsb_release -sd)
        OS_VERSION=$(lsb_release -sr)
    else
        OS_ID="unknown"
        OS_NAME="Unknown"
        OS_VERSION="unknown"
    fi

    # Normalize OS_ID for derivatives
    case "$OS_ID" in
        ubuntu|debian|linuxmint|pop|elementary|zorin)
            OS_FAMILY="debian"
            PKG_MANAGER="apt"
            ;;
        arch|manjaro|endeavouros|garuda|artix)
            OS_FAMILY="arch"
            PKG_MANAGER="pacman"
            ;;
        fedora|rhel|centos|rocky|almalinux)
            OS_FAMILY="redhat"
            PKG_MANAGER="dnf"
            ;;
        opensuse*|suse*)
            OS_FAMILY="suse"
            PKG_MANAGER="zypper"
            ;;
        *)
            OS_FAMILY="unknown"
            PKG_MANAGER="unknown"
            ;;
    esac

    export OS_ID OS_NAME OS_VERSION OS_FAMILY PKG_MANAGER
}

# Map package names from canonical names to distro-specific names
# Usage: map_package <canonical_name>
# Canonical names are based on Ubuntu/Debian package names
map_package() {
    local canonical="$1"

    detect_os

    case "$OS_FAMILY" in
        debian)
            # Debian/Ubuntu use canonical names
            echo "$canonical"
            ;;
        arch)
            case "$canonical" in
                libcap2-bin)
                    # setcap/getcap are in libcap, but it's a base package
                    # Return empty to indicate no install needed
                    echo ""
                    ;;
                qemu-utils)
                    echo "qemu-img"
                    ;;
                genisoimage)
                    echo "cdrtools"
                    ;;
                libguestfs-tools)
                    echo "libguestfs"
                    ;;
                cargo|rustc)
                    # On Arch, 'rust' package includes both rustc and cargo
                    echo "rust"
                    ;;
                ovmf)
                    echo "edk2-ovmf"
                    ;;
                *)
                    # Try to use the same name
                    echo "$canonical"
                    ;;
            esac
            ;;
        redhat)
            case "$canonical" in
                libcap2-bin)
                    echo "libcap"
                    ;;
                qemu-utils)
                    echo "qemu-img"
                    ;;
                genisoimage)
                    echo "genisoimage"
                    ;;
                libguestfs-tools)
                    echo "libguestfs-tools"
                    ;;
                *)
                    echo "$canonical"
                    ;;
            esac
            ;;
        *)
            # Unknown OS, try canonical name
            echo "$canonical"
            ;;
    esac
}

# Update package manager cache
# Usage: pkg_update
pkg_update() {
    detect_os

    case "$PKG_MANAGER" in
        apt)
            apt-get update -qq
            ;;
        pacman)
            pacman -Sy --noconfirm &>/dev/null
            ;;
        dnf)
            dnf check-update -q || true
            ;;
        zypper)
            zypper refresh -q
            ;;
        *)
            echo "Warning: Unknown package manager, cannot update cache" >&2
            return 1
            ;;
    esac
}

# Install packages
# Usage: pkg_install <package1> [package2] ...
# Package names should be canonical (Debian/Ubuntu) names
pkg_install() {
    detect_os

    local packages=()
    for canonical in "$@"; do
        local mapped
        mapped=$(map_package "$canonical")
        if [ -n "$mapped" ]; then
            packages+=("$mapped")
        fi
    done

    if [ ${#packages[@]} -eq 0 ]; then
        return 0  # Nothing to install
    fi

    case "$PKG_MANAGER" in
        apt)
            apt-get install -y -qq "${packages[@]}"
            ;;
        pacman)
            pacman -S --noconfirm --needed "${packages[@]}"
            ;;
        dnf)
            dnf install -y -q "${packages[@]}"
            ;;
        zypper)
            zypper install -y -q "${packages[@]}"
            ;;
        *)
            echo "Error: Unknown package manager '$PKG_MANAGER'" >&2
            echo "Please install manually: ${packages[*]}" >&2
            return 1
            ;;
    esac
}

# Check if a package is installed
# Usage: pkg_is_installed <canonical_package_name>
pkg_is_installed() {
    local canonical="$1"
    local mapped
    mapped=$(map_package "$canonical")

    detect_os

    # If mapped is empty, the package isn't needed on this OS
    if [ -z "$mapped" ]; then
        return 0
    fi

    case "$PKG_MANAGER" in
        apt)
            dpkg -l "$mapped" 2>/dev/null | grep -q "^ii"
            ;;
        pacman)
            pacman -Qi "$mapped" &>/dev/null
            ;;
        dnf)
            rpm -q "$mapped" &>/dev/null
            ;;
        zypper)
            rpm -q "$mapped" &>/dev/null
            ;;
        *)
            # Fall back to checking if the command exists
            return 1
            ;;
    esac
}

# Get installation command hint for error messages
# Usage: pkg_install_hint <package1> [package2] ...
pkg_install_hint() {
    detect_os

    local packages=()
    for canonical in "$@"; do
        local mapped
        mapped=$(map_package "$canonical")
        if [ -n "$mapped" ]; then
            packages+=("$mapped")
        fi
    done

    if [ ${#packages[@]} -eq 0 ]; then
        echo "(no packages needed on $OS_NAME)"
        return
    fi

    case "$PKG_MANAGER" in
        apt)
            echo "sudo apt install ${packages[*]}"
            ;;
        pacman)
            echo "sudo pacman -S ${packages[*]}"
            ;;
        dnf)
            echo "sudo dnf install ${packages[*]}"
            ;;
        zypper)
            echo "sudo zypper install ${packages[*]}"
            ;;
        *)
            echo "Install: ${packages[*]}"
            ;;
    esac
}

# Print OS information
# Usage: print_os_info
print_os_info() {
    detect_os
    echo "OS: $OS_NAME ($OS_ID)"
    echo "Version: $OS_VERSION"
    echo "Family: $OS_FAMILY"
    echo "Package Manager: $PKG_MANAGER"
}

# Initialize on source (detect OS)
detect_os
