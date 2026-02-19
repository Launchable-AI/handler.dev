#!/bin/bash
# fix-vm-ssh-keys.sh — One-time fix: re-inject current SSH public key into all VM overlays
#
# Usage: ./scripts/dev/fix-vm-ssh-keys.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)/data"
SSH_PUB="$DATA_DIR/ssh-keys/id_ed25519.pub"
VMS_DIR="$DATA_DIR/firecracker-vms"

if [ ! -f "$SSH_PUB" ]; then
  echo "ERROR: SSH public key not found at $SSH_PUB"
  exit 1
fi

PUB_KEY=$(cat "$SSH_PUB")
echo "Public key: $PUB_KEY"
echo ""

FIXED=0
SKIPPED=0

for vm_dir in "$VMS_DIR"/fc-*/; do
  vm_id=$(basename "$vm_dir")
  overlay="$vm_dir/overlay.ext4"

  if [ ! -f "$overlay" ]; then
    echo "SKIP $vm_id — no overlay.ext4"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Get VM name from state.json if available
  vm_name=""
  if [ -f "$vm_dir/state.json" ]; then
    vm_name=$(jq -r '.name // ""' "$vm_dir/state.json")
  fi

  label="$vm_id"
  [ -n "$vm_name" ] && label="$vm_id ($vm_name)"

  # Write key to temp file
  tmp_keys="$vm_dir/authorized_keys.tmp"
  tmp_cmds="$vm_dir/debugfs_commands.tmp"
  echo "$PUB_KEY" > "$tmp_keys"
  chmod 600 "$tmp_keys"

  # debugfs commands — mkdir is idempotent (errors on existing dirs are harmless)
  cat > "$tmp_cmds" <<CMDS
mkdir /upper
mkdir /upper/home
mkdir /upper/home/agent
mkdir /upper/home/agent/.ssh
rm /upper/home/agent/.ssh/authorized_keys
write $tmp_keys /upper/home/agent/.ssh/authorized_keys
CMDS

  # debugfs prints mkdir errors for existing dirs — harmless
  debugfs -w -f "$tmp_cmds" "$overlay" 2>&1 | grep -v "^debugfs:" || true
  echo "FIXED $label"
  FIXED=$((FIXED + 1))

  rm -f "$tmp_keys" "$tmp_cmds"
done

echo ""
echo "Done: $FIXED fixed, $SKIPPED skipped"
