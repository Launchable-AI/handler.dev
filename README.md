<p align="center">
  <img src="assets/logo.png" alt="Caisson Logo" width="128" height="128">
</p>

<h1 align="center">Caisson</h1>

<p align="center">
  A web application for spawning and managing Docker containers and virtual machines, designed for isolated agentic coding environments.
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#usage">Usage</a> •
  <a href="#architecture">Architecture</a>
</p>

## Features

### Docker Containers
- **Container Management**: Create, start, stop, and remove Docker containers with a clean web UI
- **SSH Access**: Optional SSH support with auto-generated keypairs (requires SSH server in your Dockerfile)
- **Docker Exec**: Quick terminal access via `docker exec` commands, copyable from the UI
- **Persistent Volumes**: Create and attach volumes for persistent storage across containers
- **Port Forwarding**: Expose container ports to the host for web services, APIs, etc.
- **Dockerfile Editor**: Create and manage custom Dockerfiles with a Monaco editor
- **Image Management**: Build custom images, pull from registries, and manage your image library
- **Compose**: Visual composer for multi-container setups

### Virtual Machines
- **VM Management**: Create, start, stop, and remove virtual machines
- **Multiple Hypervisors**: Support for cloud-hypervisor and Firecracker
- **SSH Access**: Auto-generated SSH keys with direct VM access via TAP networking
- **Resource Configuration**: Configure vCPUs (1-32), memory (512MB-64GB), and disk (1-1000GB)
- **Copy-on-Write Disks**: Fast VM creation using QCOW2 overlays (cloud-hypervisor) or OverlayFS (Firecracker)
- **Cloud-init Integration**: Automatic VM configuration with SSH keys and package installation
- **Network Bridge**: Pre-configured TAP devices for VM networking with NAT

### Shared Features
- **MCP Servers**: Registry of Model Context Protocol servers for AI agent integration
- **OpenCode Pre-installed**: Default containers come with [OpenCode](https://opencode.ai) for AI-assisted development

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm
- Docker

#### For Virtual Machines (Optional)
- Linux host with KVM support (`/dev/kvm` must exist)
- Root access (for initial network setup)
- Rust toolchain (for building TAP helper)

### Installation

```bash
# Clone the repository
git clone https://github.com/anthropics/caisson.git
cd caisson

# Install dependencies
pnpm install

# Start development servers (backend + frontend)
pnpm dev
```

The server will start on port 4001 and the web UI on port 5173.

Open [http://localhost:5173](http://localhost:5173) in your browser.

### VM Setup (Optional)

To enable virtual machine support, run the setup script:

```bash
# Basic setup (cloud-hypervisor support)
sudo ./scripts/setup.sh

# With Firecracker support
sudo ./scripts/setup.sh --firecracker

# Check installation status
./scripts/status.sh
```

The setup script:
- Installs the `caisson-tap-helper` binary with network capabilities
- Creates a network bridge (`caisson-br0`) with NAT for VM internet access
- Downloads Ubuntu 24.04 base image
- Creates a systemd service for persistence across reboots
- Optionally installs Firecracker

**Options:**
```bash
sudo ./scripts/setup.sh --help           # Show all options
sudo ./scripts/setup.sh --skip-image     # Skip base image download
sudo ./scripts/setup.sh --firecracker    # Also install Firecracker
sudo ./scripts/setup.sh --unattended     # Non-interactive mode
```

**Uninstalling:**
```bash
sudo ./scripts/uninstall.sh              # Remove all VM support
sudo ./scripts/uninstall.sh --keep-data  # Keep VM images and data
```

**Files created:**
```
~/.local/share/caisson/
├── base-images/
│   └── ubuntu-24.04/
│       ├── rootfs.ext4   # Firecracker rootfs
│       └── vmlinux       # Kernel
├── vms/                  # cloud-hypervisor VM data
├── firecracker-vms/      # Firecracker VM data
└── ssh-keys/             # SSH keys
```

## Usage

### Creating Your First Container

1. Click **+ New Container**
2. Enter a name for your container
3. Select a base image (default includes OpenCode)
4. Optionally attach a volume for persistent storage
5. Optionally configure port forwarding
6. Click **Create**

### Connecting to a Container

**Option 1: Docker Exec (Quick)**
- Copy the `docker exec` command from the container card
- Paste into your terminal

**Option 2: SSH (if enabled in your Dockerfile)**
1. Click the **SSH** button on the container card
2. Download the generated `.pem` key file
3. Use the provided SSH command:

```bash
ssh -i ~/.ssh/container-name.pem -p 2222 dev@localhost
```

*Note: SSH requires an SSH server to be installed and running in your container image. The default Dockerfiles include SSH support.*

### Working with Volumes

Volumes persist data across container restarts and rebuilds. Common uses:
- Store your project code
- Keep configuration files
- Preserve development databases

### Custom Dockerfiles

1. Go to the **Dockerfiles** tab
2. Create a new Dockerfile or edit an existing one
3. Build an image from your Dockerfile
4. Use the image when creating new containers

### Creating Your First VM

1. Ensure VM networking is set up: `sudo ./scripts/setup.sh`
2. Click the **VMs** tab in the sidebar
3. Click **+ New VM**
4. Enter a name for your VM
5. Select a base image and hypervisor (cloud-hypervisor or Firecracker)
6. Configure resources (vCPUs, memory, disk size)
7. Click **Create**

### Connecting to a VM

1. Click the **SSH** button on the VM card
2. Download the generated `.pem` key file
3. Use the provided SSH command:

```bash
ssh -i ~/.ssh/vm-name.pem agent@<vm-ip>
```

*Note: VM IPs are assigned from the 172.31.0.0/24 subnet.*

## Architecture

- **Backend**: Node.js with Hono framework, dockerode for Docker API
- **Frontend**: React 19 + Vite + Tailwind CSS v4 + TanStack Query
- **VM Networking**: Custom TAP helper with CAP_NET_ADMIN capabilities
- **Monorepo**: pnpm workspaces

### Project Structure

```
├── packages/
│   ├── server/          # Hono backend API
│   │   ├── src/
│   │   │   ├── routes/  # API endpoints (containers, vms, images, etc.)
│   │   │   ├── services/ # Docker, hypervisor & container logic
│   │   │   └── types/   # TypeScript types & Zod schemas
│   │   └── templates/   # Dockerfile templates
│   └── web/             # React frontend
│       └── src/
│           ├── api/     # API client
│           ├── components/
│           └── hooks/   # TanStack Query hooks
├── helpers/
│   └── tap-helper/      # Rust TAP device helper (caisson-tap-helper)
├── scripts/
│   ├── setup.sh         # Unified VM setup
│   ├── uninstall.sh     # Clean uninstall
│   ├── status.sh        # Check installation status
│   ├── install-tap-helper.sh
│   ├── install-firecracker.sh
│   └── download-fc-image.sh
├── guest-init/          # Scripts injected into VM images
├── assets/              # Logo and branding
├── data/                # Runtime data (gitignored)
│   ├── ssh-keys/        # Generated SSH keypairs
│   ├── dockerfiles/     # User-created Dockerfiles
│   ├── volumes/         # Container volume data
│   └── config.json      # User configuration
└── package.json
```

### VM Data Storage

VM data is stored in the user's home directory:

```
~/.local/share/caisson/
├── vms/                 # cloud-hypervisor VM data
│   └── <vm-id>/
│       ├── disk.qcow2   # VM disk overlay
│       ├── cloud-init.iso
│       ├── vm.pid       # cloud-hypervisor PID
│       └── vm.log       # VM console log
├── firecracker-vms/     # Firecracker VM data
│   └── <vm-id>/
│       ├── overlay.ext4 # Writable overlay
│       ├── vm.pid
│       └── vm.log
├── base-images/         # Base VM images (shared)
│   └── ubuntu-24.04/
│       ├── rootfs.ext4  # Firecracker rootfs
│       ├── vmlinux      # Kernel
│       ├── image.qcow2  # cloud-hypervisor image
│       └── kernel
└── ssh-keys/            # SSH keys (shared)
```

## API Reference

### Containers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/containers` | List all containers |
| POST | `/api/containers` | Create a new container |
| GET | `/api/containers/:id` | Get container details |
| POST | `/api/containers/:id/start` | Start a container |
| POST | `/api/containers/:id/stop` | Stop a container |
| DELETE | `/api/containers/:id` | Remove a container |
| GET | `/api/containers/:id/ssh-key` | Download SSH private key |

### Volumes
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/volumes` | List all volumes |
| POST | `/api/volumes` | Create a new volume |
| DELETE | `/api/volumes/:name` | Remove a volume |

### Images
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/images` | List all images |
| POST | `/api/images/pull` | Pull an image from registry |
| POST | `/api/images/build` | Build image from Dockerfile |
| DELETE | `/api/images/:id` | Remove an image |

### Virtual Machines
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/vms` | List all VMs |
| POST | `/api/vms` | Create a new VM |
| GET | `/api/vms/:id` | Get VM details |
| POST | `/api/vms/:id/start` | Start a VM |
| POST | `/api/vms/:id/stop` | Stop a VM |
| DELETE | `/api/vms/:id` | Delete a VM |
| GET | `/api/vms/:id/ssh` | Get SSH connection info |
| GET | `/api/vms/:id/logs` | Get VM logs |
| GET | `/api/vms/network` | Get network status |
| GET | `/api/vms/base-images` | List available base images |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check & Docker status |
| GET | `/api/config` | Get current configuration |

## Troubleshooting

### Check VM Setup Status
```bash
./scripts/status.sh
```

### Common Issues

**"KVM not available"**
- Ensure virtualization is enabled in BIOS/UEFI
- Check: `ls -la /dev/kvm`

**"Permission denied" for KVM**
- Add your user to the kvm group: `sudo usermod -aG kvm $USER`
- Log out and back in

**"Bridge not found"**
- Run setup: `sudo ./scripts/setup.sh`

**"TAP helper missing capabilities"**
- Reinstall: `sudo ./scripts/install-tap-helper.sh --setup-bridge`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
