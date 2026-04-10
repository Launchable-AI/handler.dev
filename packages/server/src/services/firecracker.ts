/**
 * FirecrackerService - Firecracker MicroVM Management
 * Manages virtual machines using Firecracker for the Handler platform.
 *
 * Uses MMDS (MicroVM Metadata Service) for guest identity,
 * enabling fast snapshot restore with dynamic network configuration.
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess, execSync, execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as net from 'net';
import * as crypto from 'crypto';
import * as http from 'http';
import { getConfig } from './config.js';
import {
  FirecrackerConfig,
  DEFAULT_FIRECRACKER_CONFIG,
  FirecrackerVmState,
  FirecrackerSnapshotInfo,
  MmdsMetadata,
  MmdsConfig,
  BootSource,
  Drive,
  NetworkInterface,
  MachineConfig,
  SnapshotCreateParams,
  SnapshotLoadParams,
} from '../types/firecracker.js';
import { VmConfig, VmInfo, VmState, SnapshotInfo } from '../types/vm.js';
import { NetworkPool, TapAllocation } from './network-pool.js';

export class FirecrackerService extends EventEmitter {
  private config: FirecrackerConfig;
  private vms: Map<string, FirecrackerVmState> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private allocatedPorts: Set<number> = new Set();
  private initialized: boolean = false;
  private networkPool: NetworkPool;

  constructor(config: Partial<FirecrackerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_FIRECRACKER_CONFIG, ...config };

    // Initialize network pool with parent data directory
    const dataDir = path.dirname(this.config.dataDir);
    this.networkPool = new NetworkPool(dataDir);
  }

  /**
   * Get the data directory path
   */
  getDataDir(): string {
    return path.dirname(this.config.dataDir);
  }

  /**
   * Initialize the Firecracker service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    console.log('[FirecrackerService] Initializing...');

    // Create required directories
    await this.ensureDirectories();

    // Check for firecracker binary
    await this.checkFirecrackerBinary();

    // Ensure SSH keys exist
    await this.ensureSshKeys();

    // Load existing VM states from disk
    await this.loadVmStates();

    // Sync VM states with running processes
    await this.syncVmStates();

    // Clean up any orphaned firecracker processes
    await this.cleanupOrphanedProcesses();

    // Initialize network pool (detects helper vs pool mode)
    await this.networkPool.initialize();

    // Register existing VMs' IPs with the network pool (prevents IP collisions)
    this.registerExistingVmIps();

    this.initialized = true;
    console.log(`[FirecrackerService] Initialized with ${this.vms.size} VMs`);

    this.emit('firecracker:initialized');
  }

  /**
   * Create necessary directories
   */
  private async ensureDirectories(): Promise<void> {
    const dirs = [this.config.dataDir, this.config.baseImagesDir, this.config.sshKeysDir];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        console.log(`[FirecrackerService] Created directory: ${dir}`);
      }
    }
  }

  /**
   * Check if firecracker binary exists
   */
  private async checkFirecrackerBinary(): Promise<void> {
    if (!fs.existsSync(this.config.firecrackerBinary)) {
      console.warn(`[FirecrackerService] Firecracker not found at ${this.config.firecrackerBinary}`);
      try {
        const whichResult = execSync('which firecracker', { encoding: 'utf-8' }).trim();
        if (whichResult) {
          this.config.firecrackerBinary = whichResult;
          console.log(`[FirecrackerService] Found firecracker at: ${whichResult}`);
        }
      } catch {
        console.warn('[FirecrackerService] Firecracker not found in PATH. VMs will fail to start.');
        console.warn('[FirecrackerService] Run: sudo ./scripts/user/install-firecracker.sh');
      }
    }
  }

  /**
   * Ensure SSH keys exist
   */
  private async ensureSshKeys(): Promise<void> {
    const privateKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519');

    if (!fs.existsSync(privateKeyPath)) {
      console.log('[FirecrackerService] Generating SSH keys');
      try {
        execSync(`ssh-keygen -t ed25519 -f ${privateKeyPath} -N "" -q`, {
          encoding: 'utf-8',
        });
        fs.chmodSync(privateKeyPath, 0o600);
        console.log('[FirecrackerService] SSH keys generated');
      } catch (error) {
        console.error('[FirecrackerService] Failed to generate SSH keys:', error);
      }
    }
  }

  /**
   * Load existing VM states from disk
   */
  private async loadVmStates(): Promise<void> {
    const vmsDir = this.config.dataDir;
    if (!fs.existsSync(vmsDir)) return;

    const entries = fs.readdirSync(vmsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const statePath = path.join(vmsDir, entry.name, 'state.json');
        if (fs.existsSync(statePath)) {
          try {
            const stateJson = fs.readFileSync(statePath, 'utf-8');
            const state = JSON.parse(stateJson) as FirecrackerVmState;
            this.vms.set(state.id, state);
            if (state.sshPort) {
              this.allocatedPorts.add(state.sshPort);
            }
          } catch (error) {
            console.error(`[FirecrackerService] Failed to load VM state from ${statePath}:`, error);
          }
        }
      }
    }
  }

  /**
   * Register existing VMs' IP addresses with the network pool
   * This prevents IP collisions when creating new VMs
   */
  private registerExistingVmIps(): void {
    for (const [vmId, vm] of this.vms) {
      if (vm.guestIp && vm.networkConfig) {
        this.networkPool.registerExistingVm(vmId, vm.guestIp, {
          tapName: vm.networkConfig.tapDevice,
          gateway: vm.networkConfig.gateway,
          macAddress: vm.networkConfig.macAddress,
          bridgeName: vm.networkConfig.bridgeName,
        });
      }
    }
  }

  /**
   * Sync VM states with actual running processes
   */
  private async syncVmStates(): Promise<void> {
    const STARTUP_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

    for (const [id, vm] of this.vms) {
      // Clear stale statusMessage from previous server sessions (e.g. server restarted during snapshot)
      if (vm.statusMessage) {
        console.log(`[FirecrackerService] Clearing stale statusMessage for VM ${id}: "${vm.statusMessage}"`);
        vm.statusMessage = undefined;
        await this.saveVmState(vm);
      }

      // Recover VMs stuck in paused state (e.g. server restarted during snapshot)
      if (vm.status === 'paused' && vm.pid) {
        if (this.isProcessRunning(vm.pid) && vm.apiSocket && fs.existsSync(vm.apiSocket)) {
          try {
            await this.sendApiRequest(vm.apiSocket, 'PATCH', '/vm', { state: 'Resumed' });
            vm.status = 'running';
            await this.saveVmState(vm);
            console.log(`[FirecrackerService] Recovered paused VM ${id} (${vm.name}) — resumed`);
          } catch (err) {
            console.error(`[FirecrackerService] Failed to resume paused VM ${id}:`, err);
            vm.status = 'error';
            vm.error = 'VM was paused but could not be resumed after server restart';
            await this.saveVmState(vm);
          }
        } else if (!vm.pid || !this.isProcessRunning(vm.pid)) {
          console.warn(`[FirecrackerService] VM ${id} was paused but process is gone — marking stopped`);
          vm.status = 'stopped';
          vm.pid = undefined;
          vm.stoppedAt = new Date().toISOString();
          await this.saveVmState(vm);
        }
      } else if (vm.status === 'stopping') {
        // Server restarted during a background shutdown — finish the job
        if (vm.pid && this.isProcessRunning(vm.pid)) {
          console.warn(`[FirecrackerService] VM ${id} was stopping — resuming shutdown`);
          this.performGracefulShutdown(id).catch(err =>
            console.error(`[FirecrackerService] Failed to finish shutdown for VM ${id}:`, err)
          );
        } else {
          console.warn(`[FirecrackerService] VM ${id} was stopping and process is gone — marking stopped`);
          vm.status = 'stopped';
          vm.pid = undefined;
          vm.stoppedAt = new Date().toISOString();
          if (vm.networkConfig?.tapDevice) {
            try { await this.networkPool.releaseAsync(vm.networkConfig.tapDevice, id); } catch {}
            vm.networkConfig.tapDevice = undefined;
            vm.networkConfig.guestIp = undefined;
            vm.networkConfig.mode = 'none';
            vm.guestIp = undefined;
          }
          await this.saveVmState(vm);
        }
      } else if (vm.status === 'running' && vm.pid) {
        if (!this.isProcessRunning(vm.pid)) {
          console.warn(`[FirecrackerService] VM ${id} was running but process ${vm.pid} is gone`);
          vm.status = 'stopped';
          vm.pid = undefined;
          vm.stoppedAt = new Date().toISOString();
          await this.saveVmState(vm);
        }
      } else if (vm.status === 'booting' || vm.status === 'creating') {
        const processAlive = vm.pid ? this.isProcessRunning(vm.pid) : false;
        const startedAt = vm.startedAt ? new Date(vm.startedAt).getTime() : 0;
        const elapsed = Date.now() - startedAt;

        if (!processAlive) {
          // Process is dead — mark as error so user can retry or delete
          console.warn(`[FirecrackerService] VM ${id} was ${vm.status} but process is gone — marking as error`);
          vm.status = 'error';
          vm.error = `VM got stuck in '${vm.status}' state and the process exited`;
          vm.pid = undefined;
          if (vm.networkConfig?.tapDevice) {
            try {
              await this.networkPool.releaseAsync(vm.networkConfig.tapDevice, id);
            } catch {}
            vm.networkConfig.tapDevice = undefined;
          }
          await this.saveVmState(vm);
        } else if (processAlive && vm.status === 'booting' && vm.guestIp) {
          // Process is alive and has an IP — check if SSH is actually ready
          // (happens when server restarts during boot sequence)
          try {
            const sshKeyPath = this.getSshKeyPath();
            execFileSync('ssh', [
              '-i', sshKeyPath,
              '-o', 'StrictHostKeyChecking=no',
              '-o', 'UserKnownHostsFile=/dev/null',
              '-o', 'ConnectTimeout=2',
              '-o', 'BatchMode=yes',
              '-o', 'LogLevel=ERROR',
              `agent@${vm.guestIp}`,
              'echo ok'
            ], { timeout: 5000 });
            // SSH works — transition to running
            vm.status = 'running';
            vm.statusMessage = undefined;
            await this.saveVmState(vm);
            console.log(`[FirecrackerService] Recovered booting VM ${id} (${vm.name}) — SSH reachable, now running`);
          } catch {
            // SSH not ready yet — leave as booting, will be caught by timeout below
            console.log(`[FirecrackerService] VM ${id} (${vm.name}) still booting — SSH not ready yet (${Math.round(elapsed / 1000)}s)`);
          }
        } else if (elapsed > STARTUP_TIMEOUT_MS) {
          // Process is alive but startup timed out — kill and mark as error
          console.warn(`[FirecrackerService] VM ${id} stuck in '${vm.status}' for ${Math.round(elapsed / 1000)}s — killing and marking as error`);
          try {
            process.kill(vm.pid!, 'SIGKILL');
            await this.waitForProcessExit(vm.pid!, 3000);
          } catch {}
          vm.status = 'error';
          vm.error = `VM startup timed out after ${Math.round(elapsed / 1000)} seconds`;
          vm.pid = undefined;
          if (vm.networkConfig?.tapDevice) {
            try {
              await this.networkPool.releaseAsync(vm.networkConfig.tapDevice, id);
            } catch {}
            vm.networkConfig.tapDevice = undefined;
          }
          this.processes.delete(id);
          await this.saveVmState(vm);
        }
      }
    }
  }

  /**
   * Find and kill orphaned firecracker processes that reference our data directory
   */
  private async cleanupOrphanedProcesses(): Promise<void> {
    try {
      const result = execSync('pgrep -af firecracker 2>/dev/null || true', { encoding: 'utf-8' });

      const vmLines = result.split('\n').filter(line => line.includes(this.config.dataDir));
      for (const line of vmLines) {
        const vmIdMatch = line.match(new RegExp(`${this.config.dataDir}/([^/]+)/`));
        if (vmIdMatch) {
          const vmId = vmIdMatch[1];
          if (!this.vms.has(vmId)) {
            const pidMatch = line.match(/^(\d+)/);
            if (pidMatch) {
              const pid = parseInt(pidMatch[1], 10);
              console.warn(`[FirecrackerService] Killing orphaned VM process: PID ${pid}, VM ID ${vmId}`);
              try {
                process.kill(pid, 'SIGTERM');
              } catch (e) {
                // Process may have already exited
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('[FirecrackerService] Failed to cleanup orphaned processes:', error);
    }
  }

  /**
   * Check if a process is running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Kill a process and its entire process group.
   * Firecracker is spawned with detached:true (setsid), so the PID is also the PGID.
   * Killing the group ensures no child processes (sg, shell) survive.
   */
  private killProcessGroup(pid: number, signal: NodeJS.Signals = 'SIGKILL'): void {
    // Try group kill first (negative PID)
    try {
      process.kill(-pid, signal);
    } catch {
      // Group kill failed (maybe not a group leader), fall back to individual
      try {
        process.kill(pid, signal);
      } catch {}
    }
  }

  /**
   * Find any Firecracker processes using a specific API socket path.
   * Scans /proc for processes whose cmdline matches the socket path.
   * Returns PIDs of matching processes (excludes our own PID).
   */
  private findFirecrackerPids(apiSocketPath: string): number[] {
    const pids: number[] = [];
    try {
      const procDirs = fs.readdirSync('/proc').filter(d => /^\d+$/.test(d));
      for (const pidStr of procDirs) {
        const pid = parseInt(pidStr, 10);
        if (pid === process.pid) continue;
        try {
          const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8');
          if (cmdline.includes('firecracker') && cmdline.includes(apiSocketPath)) {
            pids.push(pid);
          }
        } catch {
          // Process may have exited between readdir and readFile
        }
      }
    } catch {}
    return pids;
  }

  /**
   * Save VM state to disk
   */
  private async saveVmState(vm: FirecrackerVmState): Promise<void> {
    const vmDir = path.join(this.config.dataDir, vm.id);
    if (!fs.existsSync(vmDir)) {
      fs.mkdirSync(vmDir, { recursive: true });
    }

    const statePath = path.join(vmDir, 'state.json');
    fs.writeFileSync(statePath, JSON.stringify(vm, null, 2));
  }

  /**
   * Allocate an available SSH port
   */
  private allocateSshPort(): number {
    for (let port = this.config.sshPortRangeStart; port <= this.config.sshPortRangeEnd; port++) {
      if (!this.allocatedPorts.has(port)) {
        this.allocatedPorts.add(port);
        return port;
      }
    }
    throw new Error('No available SSH ports');
  }

  /**
   * Release an SSH port
   */
  private releaseSshPort(port: number): void {
    this.allocatedPorts.delete(port);
  }

  /**
   * Generate a unique VM ID
   */
  private generateVmId(): string {
    return 'fc-' + crypto.randomUUID().slice(0, 8);
  }

  /**
   * Normalize image name for filesystem paths
   * Docker-style names use colons (ubuntu:24.04) but we store dirs with hyphens (ubuntu-24.04)
   */
  private normalizeImageName(imageName: string): string {
    return imageName.replace(/:/g, '-');
  }

  /**
   * Generate a MAC address
   */
  private generateMacAddress(): string {
    const bytes = crypto.randomBytes(6);
    bytes[0] = (bytes[0] & 0xfe) | 0x02; // Set locally administered bit
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(':');
  }

  /**
   * Create a new VM
   */
  async createVm(config: VmConfig): Promise<VmInfo> {
    console.log(`[FirecrackerService] Creating VM: ${config.name}`);

    // Check for name uniqueness
    for (const vm of this.vms.values()) {
      if (vm.name === config.name) {
        throw new Error(`VM with name '${config.name}' already exists`);
      }
    }

    // If creating from snapshot, use cloneFromSnapshot (fresh boot with snapshot's disk)
    if (config.fromSnapshot) {
      const { vmId: sourceVmId, snapshotId } = config.fromSnapshot;
      const snapshotDir = path.join(this.config.dataDir, sourceVmId, 'snapshots', snapshotId);

      if (!fs.existsSync(snapshotDir)) {
        throw new Error(`Snapshot ${snapshotId} not found for VM ${sourceVmId}`);
      }

      // Clone creates a NEW independent VM with fresh boot
      return this.cloneFromSnapshot(snapshotDir, { name: config.name });
    }

    const id = this.generateVmId();
    const sshPort = this.allocateSshPort();
    const vmDir = path.join(this.config.dataDir, id);

    // Create VM directory
    fs.mkdirSync(vmDir, { recursive: true });

    // Try to allocate TAP device for networking
    let tapAllocation: TapAllocation | null = null;
    let networkMode: 'tap' | 'none' = 'none';

    try {
      const status = this.networkPool.checkHealth();
      const poolMode = this.networkPool.getMode();

      if (poolMode === 'helper' || (status.healthy && status.availableTaps > 0)) {
        tapAllocation = await this.networkPool.allocateAsync(id);
        networkMode = 'tap';
        console.log(`[FirecrackerService] Allocated TAP ${tapAllocation.tapName} for VM ${id}`);
      } else {
        console.warn(`[FirecrackerService] No TAP available for VM ${id}: ${status.message}`);
      }
    } catch (error) {
      console.warn(`[FirecrackerService] Failed to allocate TAP for VM ${id}:`, error);
    }

    // Get resource configuration
    const appConfig = await getConfig();
    const defaultImage = appConfig.defaultFirecrackerImage || this.config.defaultBaseImage;
    const baseImage = config.baseImage || defaultImage;
    const vcpus = config.vcpus || this.config.defaultVcpus;
    const memoryMb = config.memoryMb || this.config.defaultMemoryMb;
    const diskGb = config.diskGb || this.config.defaultDiskGb;

    // Build MMDS metadata
    const sshPubKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519.pub');
    const sshPublicKey = fs.existsSync(sshPubKeyPath)
      ? fs.readFileSync(sshPubKeyPath, 'utf-8').trim()
      : '';

    const mmdsMetadata: MmdsMetadata = {
      instance: {
        id,
        name: config.name,
        hostname: config.name,
      },
      network: {
        interfaces: {
          eth0: {
            mac: tapAllocation?.macAddress || this.generateMacAddress(),
            ipv4: {
              address: tapAllocation?.guestIp || '0.0.0.0',
              netmask: '255.255.255.0',
              gateway: tapAllocation?.gateway || '0.0.0.0',
            },
          },
        },
        dns: ['8.8.8.8', '8.8.4.4'],
      },
      ssh: {
        authorized_keys: sshPublicKey ? [sshPublicKey] : [],
      },
    };

    // Create initial state
    const vm: FirecrackerVmState = {
      id,
      name: config.name,
      status: 'creating',
      sshPort,
      guestIp: tapAllocation?.guestIp,
      networkConfig: {
        mode: networkMode,
        tapDevice: tapAllocation?.tapName,
        bridgeName: tapAllocation?.bridgeName,
        macAddress: tapAllocation?.macAddress || mmdsMetadata.network.interfaces.eth0.mac,
        guestIp: tapAllocation?.guestIp,
        gateway: tapAllocation?.gateway,
      },
      portMappings: config.portMappings || [],
      baseImage,
      vcpus,
      memoryMb,
      diskGb,
      volumes: config.volumes || [],
      mmdsMetadata,
      createdAt: new Date().toISOString(),
    };

    this.vms.set(id, vm);
    await this.saveVmState(vm);

    this.emit('vm:created', vm);
    console.log(`[FirecrackerService] VM ${id} created`);

    // Auto-start if requested
    if (config.autoStart !== false) {
      try {
        await this.startVm(id);
      } catch (error) {
        console.error(`[FirecrackerService] Failed to auto-start VM ${id}:`, error);
        vm.status = 'error';
        vm.error = String(error);
        await this.saveVmState(vm);
      }
    }

    return this.vmToInfo(vm);
  }

  /**
   * Start a VM
   */
  async startVm(id: string): Promise<VmInfo> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status === 'running') {
      console.warn(`[FirecrackerService] VM ${id} is already running`);
      return this.vmToInfo(vm);
    }

    console.log(`[FirecrackerService] Starting VM ${id} (${vm.name})`);

    const vmDir = path.join(this.config.dataDir, id);
    const logFile = path.join(vmDir, 'firecracker.log');

    // Unix domain sockets have a 108-char path limit (SUN_LEN).
    // When the data dir path is long (e.g. worktrees, deeply nested installs),
    // use a short /tmp path for the socket and symlink it back.
    const idealSocketPath = path.join(vmDir, 'api.sock');
    let apiSocket: string;
    if (idealSocketPath.length >= 104) {
      const tmpSocketDir = path.join(os.tmpdir(), `handler-fc-${id}`);
      if (!fs.existsSync(tmpSocketDir)) {
        fs.mkdirSync(tmpSocketDir, { recursive: true });
      }
      apiSocket = path.join(tmpSocketDir, 'api.sock');
      console.log(`[FirecrackerService] Socket path too long (${idealSocketPath.length} chars), using ${apiSocket}`);
    } else {
      apiSocket = idealSocketPath;
    }

    try {
      // Kill ALL Firecracker processes for this VM — by saved PID and by scanning /proc.
      // The saved PID may be stale (server restart, PID reuse) so we also scan for any
      // process using this VM's API socket path.
      if (vm.pid && this.isProcessRunning(vm.pid)) {
        console.log(`[FirecrackerService] Killing lingering Firecracker process ${vm.pid} for VM ${id} (was ${vm.status})`);
        this.killProcessGroup(vm.pid);
        await this.waitForProcessExit(vm.pid, 3000);
        this.processes.delete(id);
        vm.pid = undefined;
      }

      // Scan /proc for orphaned Firecracker processes using this VM's socket path.
      // This catches processes that survived a server restart (detached + unref'd).
      const orphanPids = this.findFirecrackerPids(apiSocket);
      if (orphanPids.length > 0) {
        console.warn(`[FirecrackerService] Found ${orphanPids.length} orphaned Firecracker process(es) for VM ${id}: ${orphanPids.join(', ')}`);
        for (const pid of orphanPids) {
          this.killProcessGroup(pid);
        }
        // Wait for orphans to die
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      if (vm.status === 'error' || vm.status === 'creating' || vm.status === 'booting') {
        console.log(`[FirecrackerService] Cleaning up stale resources for VM ${id} (was ${vm.status})`);
        vm.error = undefined;
      }

      // Always release stale TAP before re-allocating — even for stopped VMs.
      // syncVmStates marks dead VMs as 'stopped' without releasing the TAP, so the
      // device may be persistent but stale (no longer on the bridge, wrong owner, etc).
      if (vm.networkConfig.tapDevice) {
        try {
          await this.networkPool.releaseAsync(vm.networkConfig.tapDevice, id);
        } catch {}
        vm.networkConfig.tapDevice = undefined;
        vm.networkConfig.guestIp = undefined;
        vm.networkConfig.mode = 'none';
        vm.guestIp = undefined;
      }

      // Re-allocate TAP device if we don't have one (e.g., VM was stopped)
      if (!vm.networkConfig.tapDevice || vm.networkConfig.mode !== 'tap') {
        try {
          const status = this.networkPool.checkHealth();
          const poolMode = this.networkPool.getMode();

          if (poolMode === 'helper' || (status.healthy && status.availableTaps > 0)) {
            const tapAllocation = await this.networkPool.allocateAsync(id);
            vm.networkConfig.mode = 'tap';
            vm.networkConfig.tapDevice = tapAllocation.tapName;
            vm.networkConfig.bridgeName = tapAllocation.bridgeName;
            vm.networkConfig.macAddress = tapAllocation.macAddress;
            vm.networkConfig.guestIp = tapAllocation.guestIp;
            vm.networkConfig.gateway = tapAllocation.gateway;
            vm.guestIp = tapAllocation.guestIp;

            // Update MMDS metadata with new network info
            if (vm.mmdsMetadata) {
              vm.mmdsMetadata.network.interfaces.eth0.mac = tapAllocation.macAddress;
              vm.mmdsMetadata.network.interfaces.eth0.ipv4.address = tapAllocation.guestIp;
              vm.mmdsMetadata.network.interfaces.eth0.ipv4.gateway = tapAllocation.gateway;
            }

            console.log(`[FirecrackerService] Re-allocated TAP ${tapAllocation.tapName} for VM ${id}`);
          } else {
            console.warn(`[FirecrackerService] No TAP available for VM ${id}: ${status.message}`);
          }
        } catch (error) {
          console.warn(`[FirecrackerService] Failed to allocate TAP for VM ${id}:`, error);
        }
      }

      // Remove old socket if exists
      if (fs.existsSync(apiSocket)) {
        fs.unlinkSync(apiSocket);
      }

      // Prepare disk images (base read-only + overlay writable)
      const diskPaths = await this.prepareDiskImage(vm, vmDir);

      // Inject boot optimizations into the overlay before the guest mounts it
      this.injectBootFixes(diskPaths.overlayPath);

      // Spawn Firecracker process
      const logFd = fs.openSync(logFile, 'a');

      const proc = spawn('sg', ['kvm', '-c', `${this.config.firecrackerBinary} --api-sock ${apiSocket}`], {
        detached: true,
        stdio: ['ignore', logFd, logFd],
      });

      fs.closeSync(logFd);
      proc.unref();
      this.processes.set(id, proc);

      vm.pid = proc.pid;
      vm.apiSocket = apiSocket;
      vm.status = 'creating';
      vm.startedAt = new Date().toISOString();
      vm.error = undefined;

      await this.saveVmState(vm);

      // Configure and start VM in background
      this.configureAndStartVm(id, vmDir, apiSocket, diskPaths);

      console.log(`[FirecrackerService] VM ${id} starting with PID ${proc.pid}`);

      return this.vmToInfo(vm);
    } catch (error) {
      vm.status = 'error';
      vm.error = String(error);
      await this.saveVmState(vm);
      throw error;
    }
  }

  /**
   * Prepare disk images for the VM using in-guest OverlayFS
   *
   * This approach requires NO root privileges on the host. Instead:
   * 1. Base rootfs is mounted READ-ONLY by Firecracker
   * 2. A small overlay ext4 file is created per-VM (sparse, ~1MB initially)
   * 3. Guest kernel uses overlayfs to combine them (via /sbin/overlay-init)
   *
   * For layered images (created via snapshot promotion):
   * - Multiple parent layers are mounted as additional read-only drives
   * - overlay-init sets up multi-layer overlayfs: base -> layer1 -> layer2 -> vm-overlay
   *
   * Benefits:
   * - No root/sudo required on host
   * - True copy-on-write (only changed blocks stored in overlay)
   * - Base image shared read-only by all VMs
   * - Each VM overlay is ~1MB initially, grows only as data is written
   * - Promoted images only store the diff (~100MB vs ~2.5GB)
   *
   * Returns: { basePath, overlayPath, dockerVolumePath?, parentLayers? } for configuring Firecracker drives
   */
  private async prepareDiskImage(vm: FirecrackerVmState, vmDir: string): Promise<{ basePath: string; overlayPath: string; dockerVolumePath?: string; parentLayers?: string[] }> {
    // Get the full layer chain for this image
    const layerChain = this.getImageLayerChain(vm.baseImage);
    const isLayered = layerChain.length > 1;

    if (isLayered) {
      console.log(`[FirecrackerService] Image ${vm.baseImage} is layered with ${layerChain.length} layers: ${layerChain.join(' -> ')}`);
    }

    // The root base image is always the first in the chain
    const rootImageName = layerChain[0];
    const normalizedRootName = this.normalizeImageName(rootImageName);
    const rootImageDir = path.join(this.config.baseImagesDir, normalizedRootName);
    const basePath = path.join(rootImageDir, 'rootfs.ext4');

    // Ensure root base image exists
    if (!fs.existsSync(basePath)) {
      // Check for QCOW2 image and convert (one-time operation)
      const qcow2Path = path.join(rootImageDir, 'image.qcow2');
      if (fs.existsSync(qcow2Path)) {
        console.log(`[FirecrackerService] Converting QCOW2 to raw for Firecracker`);
        execSync(`qemu-img convert -f qcow2 -O raw "${qcow2Path}" "${basePath}"`, {
          stdio: 'pipe',
        });
      } else {
        throw new Error(`Base image not found: ${rootImageName}. Run scripts/dev/prepare-fc-image.sh first.`);
      }
    }

    // Collect parent layer paths (intermediate layers, excluding root base and the image itself)
    const parentLayers: string[] = [];
    for (let i = 1; i < layerChain.length; i++) {
      const layerName = layerChain[i];
      const normalizedLayerName = this.normalizeImageName(layerName);
      const layerDir = path.join(this.config.baseImagesDir, normalizedLayerName);
      const layerPath = path.join(layerDir, 'layer.ext4');

      if (!fs.existsSync(layerPath)) {
        throw new Error(`Layer file not found for ${layerName}: ${layerPath}`);
      }

      parentLayers.push(layerPath);
    }

    // Create or expand VM's own overlay
    const overlayPath = path.join(vmDir, 'overlay.ext4');
    const desiredSize = Math.max(vm.diskGb || 5, 5);
    if (!fs.existsSync(overlayPath)) {
      console.log(`[FirecrackerService] Creating ${desiredSize}GB overlay for VM ${vm.id} (sparse, ~1MB actual)`);
      execSync(`truncate -s ${desiredSize}G "${overlayPath}"`, { stdio: 'pipe' });
      execSync(`mkfs.ext4 -F -q "${overlayPath}"`, { stdio: 'pipe' });
    } else {
      // Expand if diskGb increased since creation
      const currentBytes = fs.statSync(overlayPath).size;
      const desiredBytes = desiredSize * 1024 * 1024 * 1024;
      if (desiredBytes > currentBytes) {
        console.log(`[FirecrackerService] Expanding overlay from ${(currentBytes / 1024 / 1024 / 1024).toFixed(0)}GB to ${desiredSize}GB for VM ${vm.id}`);
        execFileSync('truncate', ['-s', `${desiredSize}G`, overlayPath], { stdio: 'pipe' });
        try {
          execFileSync('e2fsck', ['-f', '-y', overlayPath], { stdio: 'pipe' });
        } catch {
          // e2fsck returns non-zero if it made changes (e.g. fixed dirty journal), which is expected
        }
        // Best-effort host-side resize; definitive resize happens inside the guest after boot
        try {
          execFileSync('resize2fs', [overlayPath], { stdio: 'pipe' });
        } catch {
          console.log(`[FirecrackerService] Host-side resize2fs skipped for overlay (will resize in guest)`);
        }
      }
    }

    // Create or expand dedicated Docker volume (ext4, for /var/lib/docker)
    // This avoids nested overlayfs issues: Docker overlay2 operates on ext4 directly
    // instead of on top of the guest's overlayfs root.
    const dockerVolumePath = path.join(vmDir, 'docker-volume.ext4');
    const dockerVolumeSize = Math.max(vm.diskGb || 10, 5);
    if (!fs.existsSync(dockerVolumePath)) {
      console.log(`[FirecrackerService] Creating ${dockerVolumeSize}GB Docker volume for VM ${vm.id} (sparse)`);
      execSync(`truncate -s ${dockerVolumeSize}G "${dockerVolumePath}"`, { stdio: 'pipe' });
      execSync(`mkfs.ext4 -F -q "${dockerVolumePath}"`, { stdio: 'pipe' });
    } else {
      // Expand if diskGb increased since creation
      const currentBytes = fs.statSync(dockerVolumePath).size;
      const desiredBytes = dockerVolumeSize * 1024 * 1024 * 1024;
      if (desiredBytes > currentBytes) {
        console.log(`[FirecrackerService] Expanding Docker volume from ${(currentBytes / 1024 / 1024 / 1024).toFixed(0)}GB to ${dockerVolumeSize}GB for VM ${vm.id}`);
        execFileSync('truncate', ['-s', `${dockerVolumeSize}G`, dockerVolumePath], { stdio: 'pipe' });
        try {
          execFileSync('e2fsck', ['-f', '-y', dockerVolumePath], { stdio: 'pipe' });
        } catch {
          // e2fsck returns non-zero if it made changes (e.g. fixed dirty journal), which is expected
        }
        try {
          execFileSync('resize2fs', [dockerVolumePath], { stdio: 'pipe' });
        } catch {
          console.log(`[FirecrackerService] Host-side resize2fs skipped for docker volume (will resize in guest)`);
        }
      }
    }

    return {
      basePath,
      overlayPath,
      dockerVolumePath,
      parentLayers: parentLayers.length > 0 ? parentLayers : undefined,
    };
  }

  /**
   * Inject boot optimizations into the overlay ext4 before the VM starts.
   * Writes into the overlayfs upper layer so the changes override the base
   * rootfs once the guest mounts everything.
   *
   * Uses debugfs (which can edit unmounted ext4 images) instead of mount,
   * so this works as a regular user with no loop devices required.
   *
   * Fixes injected:
   *   1. Symlink masking systemd-networkd-wait-online — that service blocks
   *      network-online.target for ~2 min in DNS-less guests since networking
   *      comes from the kernel ip= parameter, not networkd.
   *   2. sshd_config.d snippet setting UseDNS no — without this the sshd
   *      banner exchange hangs on reverse DNS lookup of the client IP.
   *      (Ubuntu 22.04+ sshd_config has Include /etc/ssh/sshd_config.d/*.conf.)
   *
   * This is a host-side safety net for VMs whose base image has an older
   * overlay-init that doesn't apply these fixes inside the guest.
   */
  private injectBootFixes(overlayPath: string): void {
    try {
      // Replay journal if needed — debugfs refuses to write to a dirty ext4.
      // e2fsck exits non-zero when it makes corrections, which is expected here.
      try {
        execFileSync('e2fsck', ['-p', '-f', overlayPath], { stdio: 'pipe' });
      } catch {
        // Preen made changes (or filesystem was already clean and we got 0). Either way, continue.
      }

      // 1. Mask systemd-networkd-wait-online via symlink in overlayfs upper.
      const maskPath = 'upper/etc/systemd/system/systemd-networkd-wait-online.service';
      if (!this.debugfsPathExists(overlayPath, maskPath)) {
        this.debugfsMkdirP(overlayPath, 'upper/etc/systemd/system');
        this.runDebugfs(overlayPath, [`symlink ${maskPath} /dev/null`]);
        if (!this.debugfsPathExists(overlayPath, maskPath)) {
          throw new Error(`failed to create symlink ${maskPath}`);
        }
        console.log('[FirecrackerService] Masked systemd-networkd-wait-online in overlay');
      }

      // 2. Drop sshd snippet to disable reverse DNS lookup.
      const sshdSnippet = 'upper/etc/ssh/sshd_config.d/99-handler.conf';
      if (!this.debugfsPathExists(overlayPath, sshdSnippet)) {
        this.debugfsMkdirP(overlayPath, 'upper/etc/ssh/sshd_config.d');
        const tmpFile = path.join(os.tmpdir(), `handler-debugfs-${process.pid}-${Date.now()}.conf`);
        fs.writeFileSync(tmpFile, 'UseDNS no\n');
        try {
          this.runDebugfs(overlayPath, [`write ${tmpFile} ${sshdSnippet}`]);
        } finally {
          try { fs.unlinkSync(tmpFile); } catch {}
        }
        if (!this.debugfsPathExists(overlayPath, sshdSnippet)) {
          throw new Error(`failed to write ${sshdSnippet}`);
        }
        console.log('[FirecrackerService] Wrote sshd UseDNS no snippet to overlay');
      }
    } catch (error) {
      // Non-fatal — VM will still try to boot. May be slow or fail SSH banner exchange
      // if the base image's in-guest overlay-init doesn't apply these fixes itself.
      console.warn(`[FirecrackerService] Failed to inject boot fixes: ${(error as Error).message}`);
    }
  }

  /**
   * Check if a path exists inside an unmounted ext4 image via debugfs.
   * debugfs always exits 0, so we have to parse output for "File not found".
   */
  private debugfsPathExists(imagePath: string, p: string): boolean {
    const result = spawnSync('debugfs', ['-R', `stat ${p}`, imagePath], {
      encoding: 'utf-8',
    });
    const combined = (result.stdout || '') + (result.stderr || '');
    return !combined.includes('File not found') && !combined.includes('No such');
  }

  /**
   * mkdir -p equivalent for debugfs. Creates each missing path component.
   */
  private debugfsMkdirP(imagePath: string, dirPath: string): void {
    const parts = dirPath.split('/').filter(Boolean);
    const cmds: string[] = [];
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/');
      if (!this.debugfsPathExists(imagePath, sub)) {
        cmds.push(`mkdir ${sub}`);
      }
    }
    if (cmds.length > 0) {
      this.runDebugfs(imagePath, cmds);
    }
  }

  /**
   * Run a sequence of debugfs commands in a single -w invocation.
   * debugfs exits 0 even on errors, so we parse output for unexpected failures.
   * "already exists" messages are tolerated (idempotent).
   */
  private runDebugfs(imagePath: string, commands: string[]): void {
    const script = commands.join('\n') + '\n';
    const result = spawnSync('debugfs', ['-w', '-f', '-', imagePath], {
      input: script,
      encoding: 'utf-8',
    });
    if (result.error) {
      throw result.error;
    }
    const combined = (result.stdout || '') + (result.stderr || '');
    for (const line of combined.split('\n')) {
      if (line.includes('already exists')) continue;
      if (/error|cannot|fail|invalid/i.test(line)) {
        throw new Error(`debugfs: ${line.trim()}`);
      }
    }
  }

  /**
   * Configure and start the VM via Firecracker API
   *
   * Uses in-guest OverlayFS for copy-on-write disk support:
   * - Base rootfs mounted READ-ONLY (shared by all VMs)
   * - Overlay ext4 mounted as second drive (writable, per-VM)
   * - Guest uses /sbin/overlay-init to set up overlayfs at boot
   */
  /** Update the VM's transient status message (visible via API polling during boot) */
  private setStatusMessage(vm: FirecrackerVmState, message: string): void {
    vm.statusMessage = message;
    // Fire-and-forget save so the next poll picks it up
    this.saveVmState(vm).catch(() => {});
  }

  private async configureAndStartVm(
    id: string,
    vmDir: string,
    apiSocket: string,
    diskPaths: { basePath: string; overlayPath: string; dockerVolumePath?: string; parentLayers?: string[] }
  ): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) return;

    const startTime = Date.now();
    const hasParentLayers = diskPaths.parentLayers && diskPaths.parentLayers.length > 0;
    const numParentLayers = diskPaths.parentLayers?.length || 0;

    try {
      // Wait for API socket to be ready
      this.setStatusMessage(vm, 'Waiting for Firecracker process...');
      await this.waitForApiSocket(apiSocket, 10000, path.join(vmDir, 'firecracker.log'));
      console.log(`[FirecrackerService] API socket ready in ${Date.now() - startTime}ms`);

      // Get kernel path - prefer Firecracker-optimized kernel (vmlinux-fc)
      // The FC kernel is built with ACPI-based device discovery (no cmdline devices)
      // For layered images, the kernel is symlinked to the root base image
      const layerChain = this.getImageLayerChain(vm.baseImage);
      const rootImageName = layerChain[0];
      const normalizedRootName = this.normalizeImageName(rootImageName);
      const rootImageDir = path.join(this.config.baseImagesDir, normalizedRootName);
      const fcKernelPath = path.join(rootImageDir, 'vmlinux-fc');
      const defaultKernelPath = path.join(rootImageDir, 'vmlinux');
      const kernelPath = fs.existsSync(fcKernelPath) ? fcKernelPath : defaultKernelPath;

      if (!fs.existsSync(kernelPath)) {
        throw new Error(`Kernel not found: ${kernelPath}. Run scripts/dev/prepare-fc-image.sh first.`);
      }

      // Device assignment:
      // - vda: root base image (is_root_device: true)
      // - vdb, vdc, ...: parent layers (if any, read-only)
      // - next: overlay (writable)
      // - next: docker volume (writable, dedicated ext4 for /var/lib/docker)
      // - after: data volumes
      //
      // Device letter for overlay depends on number of parent layers:
      // - No parents: overlay = vdb, docker = vdc
      // - 1 parent: overlay = vdc, docker = vdd
      // - 2 parents: overlay = vdd, docker = vde
      const overlayDeviceLetter = String.fromCharCode('b'.charCodeAt(0) + numParentLayers);
      const overlayDevice = `vd${overlayDeviceLetter}`;
      const dockerDeviceLetter = String.fromCharCode('b'.charCodeAt(0) + numParentLayers + 1);
      const dockerDevice = diskPaths.dockerVolumePath ? `vd${dockerDeviceLetter}` : '';

      // 1. Configure boot source with overlay-init for per-VM writable layer
      // - init=/sbin/overlay-init: Use our custom init that sets up overlayfs
      // - overlay_root=vdX: Specifies which device is the writable overlay
      // - parent_layers=vdb,vdc: Specifies intermediate layer devices (if any)
      // - root=/dev/vda ro: Mount base rootfs read-only
      let bootArgs = `console=ttyS0 reboot=k panic=1 nomodule swiotlb=noforce root=/dev/vda ro init=/sbin/overlay-init overlay_root=${overlayDevice}`;

      // Add docker_volume device to boot args (dedicated ext4 for /var/lib/docker)
      // This avoids nested overlayfs: Docker's overlay2 operates on ext4 directly
      if (dockerDevice) {
        bootArgs += ` docker_volume=${dockerDevice}`;
      }

      // Add parent layer devices to boot args if this is a layered image
      if (hasParentLayers) {
        const parentDevices = diskPaths.parentLayers!.map((_, i) =>
          `vd${String.fromCharCode('b'.charCodeAt(0) + i)}`
        );
        bootArgs += ` parent_layers=${parentDevices.join(',')}`;
        console.log(`[FirecrackerService] Layered image with ${numParentLayers} parent layers: ${parentDevices.join(', ')}`);
      }

      // Add kernel-level network configuration if we have TAP networking
      if (vm.networkConfig.mode === 'tap' && vm.guestIp && vm.networkConfig.gateway) {
        const kernelIpArg = `ip=${vm.guestIp}::${vm.networkConfig.gateway}:255.255.255.0::eth0:off`;
        bootArgs += ` ${kernelIpArg}`;
        console.log(`[FirecrackerService] Using kernel ip= for network: ${kernelIpArg}`);
      }
      console.log(`[FirecrackerService] Boot args: ${bootArgs}`);

      const bootSource: BootSource = {
        kernel_image_path: kernelPath,
        boot_args: bootArgs,
      };
      await this.sendApiRequest(apiSocket, 'PUT', '/boot-source', bootSource);

      // 2. Configure root drive (READ-ONLY - shared by all VMs)
      // The overlay-init script will set up overlayfs to make it writable
      await this.sendApiRequest(apiSocket, 'PUT', '/drives/rootfs', {
        drive_id: 'rootfs',
        path_on_host: diskPaths.basePath,
        is_root_device: true,
        is_read_only: true,  // READ-ONLY: Base image shared by all VMs
      } as Drive);

      // 3. Configure parent layer drives (if any, READ-ONLY)
      if (hasParentLayers) {
        for (let i = 0; i < diskPaths.parentLayers!.length; i++) {
          const layerPath = diskPaths.parentLayers![i];
          const driveId = `layer${i}`;
          console.log(`[FirecrackerService] Configuring parent layer ${driveId}: ${layerPath}`);
          await this.sendApiRequest(apiSocket, 'PUT', `/drives/${driveId}`, {
            drive_id: driveId,
            path_on_host: layerPath,
            is_root_device: false,
            is_read_only: true,  // READ-ONLY: Parent layers are immutable
          } as Drive);
        }
      }

      // 4. Configure overlay drive (WRITABLE - per-VM overlay)
      await this.sendApiRequest(apiSocket, 'PUT', '/drives/overlay', {
        drive_id: 'overlay',
        path_on_host: diskPaths.overlayPath,
        is_root_device: false,
        is_read_only: false,  // WRITABLE: VM-specific changes go here
      } as Drive);

      // 5. Configure Docker volume drive (WRITABLE - dedicated ext4 for /var/lib/docker)
      // This avoids nested overlayfs issues: Docker overlay2 operates on ext4 directly
      if (diskPaths.dockerVolumePath) {
        console.log(`[FirecrackerService] Configuring Docker volume drive: ${diskPaths.dockerVolumePath} -> /dev/${dockerDevice}`);
        await this.sendApiRequest(apiSocket, 'PUT', '/drives/docker', {
          drive_id: 'docker',
          path_on_host: diskPaths.dockerVolumePath,
          is_root_device: false,
          is_read_only: false,
        } as Drive);
      }

      // 6. Configure attached volume drives (appear after overlay + docker)
      // First available letter after overlay and docker volume
      let dataVolumeOffset = numParentLayers + 1 + (diskPaths.dockerVolumePath ? 1 : 0); // +1 for overlay, +1 for docker
      if (vm.volumes && vm.volumes.length > 0) {
        for (let i = 0; i < vm.volumes.length; i++) {
          const volume = vm.volumes[i];
          if (volume.hostPath && fs.existsSync(volume.hostPath)) {
            const driveId = `data${i}`;
            console.log(`[FirecrackerService] Configuring volume drive ${driveId}: ${volume.hostPath} -> ${volume.mountPath}`);
            await this.sendApiRequest(apiSocket, 'PUT', `/drives/${driveId}`, {
              drive_id: driveId,
              path_on_host: volume.hostPath,
              is_root_device: false,
              is_read_only: volume.readOnly || false,
            } as Drive);
          } else {
            console.warn(`[FirecrackerService] Volume ${volume.name} path not found: ${volume.hostPath}`);
          }
        }
      }

      // 5. Configure network interface (if TAP available)
      if (vm.networkConfig.mode === 'tap' && vm.networkConfig.tapDevice) {
        await this.sendApiRequest(apiSocket, 'PUT', '/network-interfaces/eth0', {
          iface_id: 'eth0',
          host_dev_name: vm.networkConfig.tapDevice,
          guest_mac: vm.networkConfig.macAddress,
        } as NetworkInterface);
      }

      // 6. Configure machine
      await this.sendApiRequest(apiSocket, 'PUT', '/machine-config', {
        vcpu_count: vm.vcpus,
        mem_size_mib: vm.memoryMb,
      } as MachineConfig);

      // 7. Configure MMDS
      if (vm.networkConfig.mode === 'tap') {
        await this.sendApiRequest(apiSocket, 'PUT', '/mmds/config', {
          network_interfaces: ['eth0'],
          version: 'V2',
          ipv4_address: '169.254.169.254',
        } as MmdsConfig);

        // 8. Set MMDS metadata (refresh SSH key to current on every boot)
        if (vm.mmdsMetadata) {
          const currentPubKey = this.readSshPublicKey();
          if (currentPubKey) {
            vm.mmdsMetadata.ssh.authorized_keys = [currentPubKey];
          }
          await this.sendApiRequest(apiSocket, 'PUT', '/mmds', vm.mmdsMetadata);
        }
      }

      // 9. Start the VM
      this.setStatusMessage(vm, 'Configuring VM...');
      console.log(`[FirecrackerService] VM ${id} API configured in ${Date.now() - startTime}ms, sending InstanceStart`);
      await this.sendApiRequest(apiSocket, 'PUT', '/actions', {
        action_type: 'InstanceStart',
      });

      vm.status = 'booting';
      vm.statusMessage = 'Booting kernel...';
      await this.saveVmState(vm);
      this.emit('vm:booting', vm);
      console.log(`[FirecrackerService] VM ${id} is booting (InstanceStart sent at ${Date.now() - startTime}ms)`);

      // Wait for SSH to be reachable
      console.log(`[FirecrackerService] VM ${id} waiting for SSH at ${vm.networkConfig.guestIp || '127.0.0.1'}:${vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort}`);
      this.setStatusMessage(vm, 'Waiting for SSH...');
      await this.waitForSshReady(id);
      console.log(`[FirecrackerService] VM ${id} SSH ready in ${Date.now() - startTime}ms`);

      // Resize filesystems inside the guest to match expanded block devices
      // ext4 supports online resize — this is the definitive resize step
      // (host-side resize2fs is best-effort and may not work on dirty journals)
      this.setStatusMessage(vm, 'Configuring guest...');
      await this.resizeGuestFilesystems(id, overlayDevice, dockerDevice);

      // Configure hostname in /etc/hosts to avoid sudo warnings
      await this.configureHostname(id);
      console.log(`[FirecrackerService] VM ${id} post-boot config done in ${Date.now() - startTime}ms`);

      // Mount attached volumes inside the guest
      if (vm.volumes && vm.volumes.length > 0) {
        this.setStatusMessage(vm, 'Mounting volumes...');
        await this.mountVolumesInGuest(id);
        console.log(`[FirecrackerService] VM ${id} volumes mounted in ${Date.now() - startTime}ms`);
      }

      vm.status = 'running';
      vm.statusMessage = undefined;
      await this.saveVmState(vm);
      this.emit('vm:started', vm);
      console.log(`[FirecrackerService] VM ${id} is running in ${Date.now() - startTime}ms`);

    } catch (error) {
      console.error(`[FirecrackerService] VM ${id} failed to start:`, error);
      vm.status = 'error';
      vm.error = `Failed to start: ${error}`;
      vm.statusMessage = undefined;
      await this.saveVmState(vm);
      this.emit('vm:error', { vm, error });
    }
  }

  /**
   * Wait for API socket to become available
   */
  private waitForApiSocket(socketPath: string, timeoutMs: number, logFile?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const check = () => {
        if (fs.existsSync(socketPath)) {
          resolve();
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          // Check the Firecracker log for a specific error to give a better message
          let detail = '';
          if (logFile && fs.existsSync(logFile)) {
            const log = fs.readFileSync(logFile, 'utf-8');
            if (log.includes('SUN_LEN')) {
              detail = `: API socket path too long (${socketPath.length} chars, max 108). Move your Handler install to a shorter path`;
            } else if (log.includes('RunWithApiError')) {
              const match = log.match(/RunWithApiError error: (.+)/);
              detail = match ? `: ${match[1]}` : '';
            }
          }
          reject(new Error(`Timeout waiting for API socket${detail}`));
          return;
        }

        setTimeout(check, 50);
      };

      check();
    });
  }

  /**
   * Send a request to the Firecracker API socket
   */
  private async sendApiRequest(
    socketPath: string,
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      let response = '';
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          reject(new Error(`API request timeout: ${method} ${endpoint}`));
        }
      }, 10000);

      socket.on('connect', () => {
        const bodyStr = body ? JSON.stringify(body) : '';
        const request = [
          `${method} ${endpoint} HTTP/1.1`,
          'Host: localhost',
          'Accept: application/json',
          'Content-Type: application/json',
          `Content-Length: ${bodyStr.length}`,
          '',
          bodyStr,
        ].join('\r\n');

        socket.write(request);
      });

      socket.on('data', data => {
        response += data.toString();
        if (response.includes('\r\n\r\n')) {
          clearTimeout(timeout);
          if (!resolved) {
            resolved = true;
            socket.end();
            try {
              const [headers, respBody] = response.split('\r\n\r\n');
              const statusLine = headers.split('\r\n')[0];
              const statusCode = parseInt(statusLine.split(' ')[1], 10);
              if (statusCode >= 200 && statusCode < 300) {
                resolve(respBody ? JSON.parse(respBody) : null);
              } else {
                reject(new Error(`API request failed: ${statusLine} - ${respBody}`));
              }
            } catch (error) {
              reject(error);
            }
          }
        }
      });

      socket.on('error', err => {
        clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });
  }

  /**
   * Clean stale SSH multiplexing control sockets for a given host:port.
   * Prevents reuse of dead connections when TAP IPs are recycled between VMs.
   */
  private cleanSshControlSockets(host: string, port: number): void {
    const socketPatterns = [
      `/tmp/handler-metrics-agent@${host}:${port}`,
      `/tmp/handler-agent-agent@${host}:${port}`,
    ];
    for (const sock of socketPatterns) {
      try {
        if (fs.existsSync(sock)) {
          fs.unlinkSync(sock);
          console.log(`[FirecrackerService] Removed stale SSH control socket: ${sock}`);
        }
      } catch {}
    }
  }

  /**
   * Wait for SSH to be reachable
   */
  private async waitForSshReady(vmId: string, timeoutMs: number = 60000): Promise<void> {
    const startTime = Date.now();
    const sshKeyPath = this.getSshKeyPath();
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM ${vmId} not found`);
    }

    const port = vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort;
    const host = vm.networkConfig.mode === 'tap' ? vm.networkConfig.guestIp : '127.0.0.1';
    const tag = `[FirecrackerService] VM ${vmId}`;

    // Clean stale SSH multiplexing sockets from previous VMs that had this IP
    if (host) {
      this.cleanSshControlSockets(host, port!);
    }

    console.log(`${tag} SSH key: ${sshKeyPath} (exists: ${fs.existsSync(sshKeyPath)})`);

    // Diagnostic: check network reachability
    try {
      execFileSync('ping', ['-c', '1', '-W', '1', host!], { stdio: 'pipe', timeout: 3000 });
      console.log(`${tag} ping ${host} OK`);
    } catch {
      console.warn(`${tag} ping ${host} FAILED — network may not be up yet`);
    }

    // Phase 1: Wait for TCP port to accept connections (fast — no SSH overhead)
    let portOpen = false;
    let attempts = 0;
    while (!portOpen) {
      attempts++;
      if (Date.now() - startTime > timeoutMs) {
        throw new Error(`Timeout waiting for SSH port ${port} on ${host} (${attempts} attempts over ${Math.round((Date.now() - startTime) / 1000)}s)`);
      }
      if (attempts > 1) {
        this.setStatusMessage(vm, `Waiting for SSH port... (${Math.round((Date.now() - startTime) / 1000)}s)`);
      }
      portOpen = await new Promise<boolean>(resolve => {
        const sock = net.createConnection({ host: host!, port, timeout: 2000 });
        sock.on('connect', () => { sock.destroy(); resolve(true); });
        sock.on('error', (e) => { sock.destroy(); if (attempts % 5 === 0) console.log(`${tag} TCP connect attempt ${attempts}: ${e.message}`); resolve(false); });
        sock.on('timeout', () => { sock.destroy(); if (attempts % 5 === 0) console.log(`${tag} TCP connect attempt ${attempts}: timeout`); resolve(false); });
      });
      if (!portOpen) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    const phase1Elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`${tag} SSH port ${port} open after ${phase1Elapsed}s (${attempts} TCP attempts)`);

    // Phase 2: Wait for SSH auth to succeed (port is open, now verify SSH works)
    // Uses verbose SSH (-v) to capture handshake details in stderr for diagnostics.
    let sshAttempts = 0;
    while (true) {
      sshAttempts++;
      this.setStatusMessage(vm, `SSH handshake attempt ${sshAttempts}... (${Math.round((Date.now() - startTime) / 1000)}s)`);
      const attemptStart = Date.now();
      try {
        execFileSync('ssh', [
          '-v',
          '-i', sshKeyPath,
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'UserKnownHostsFile=/dev/null',
          '-o', 'ConnectTimeout=3',
          '-o', 'IdentitiesOnly=yes',
          '-o', 'BatchMode=yes',
          `agent@${host}`,
          '-p', port!.toString(),
          'echo ready',
        ], { stdio: 'pipe', timeout: 5000 });
        console.log(`${tag} SSH ready after ${Math.round((Date.now() - startTime) / 1000)}s (attempt ${sshAttempts})`);
        return;
      } catch (err: unknown) {
        const stdout = (err as { stdout?: Buffer })?.stdout?.toString?.()?.trim() || '';
        if (stdout.includes('ready')) {
          console.log(`${tag} SSH ready (stdout) after ${Math.round((Date.now() - startTime) / 1000)}s (attempt ${sshAttempts})`);
          return;
        }

        const attemptDuration = Math.round((Date.now() - attemptStart) / 1000);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const stderr = (err as { stderr?: Buffer })?.stderr?.toString?.()?.trim() || '';
        const errCode = (err as { status?: number })?.status;
        const signal = (err as { signal?: string })?.signal;

        // Extract the key SSH debug lines (last stage reached, errors)
        const stderrLines = stderr.split('\n');
        const lastDebugLine = stderrLines.filter(l => l.startsWith('debug1:')).pop() || '';
        const errorLines = stderrLines.filter(l =>
          !l.startsWith('debug1:') && !l.startsWith('debug2:') && !l.startsWith('debug3:') &&
          !l.startsWith('Warning:') && l.trim() !== ''
        );

        console.warn(`${tag} SSH attempt ${sshAttempts} failed after ${attemptDuration}s (total ${elapsed}s): exit=${errCode} signal=${signal}`);
        console.warn(`${tag}   last stage: ${lastDebugLine}`);
        if (errorLines.length > 0) {
          console.warn(`${tag}   errors: ${errorLines.join(' | ')}`);
        }

        // On the last attempt before timeout, dump full verbose output
        if (Date.now() - startTime + 5000 > timeoutMs) {
          console.warn(`${tag} FULL SSH DIAGNOSTIC (attempt ${sshAttempts}):`);
          for (const line of stderrLines.slice(-30)) {
            console.warn(`${tag}   ${line}`);
          }
          if (stdout) {
            console.warn(`${tag}   stdout: ${stdout}`);
          }

          // Also run network diagnostics
          try {
            const pingResult = execFileSync('ping', ['-c', '1', '-W', '2', host!], { stdio: 'pipe', timeout: 4000 }).toString().trim();
            console.warn(`${tag}   ping: ${pingResult.split('\n').pop()}`);
          } catch {
            console.warn(`${tag}   ping: FAILED`);
          }
          try {
            const arpResult = execFileSync('ip', ['neigh', 'show', host!], { stdio: 'pipe', timeout: 2000 }).toString().trim();
            console.warn(`${tag}   arp: ${arpResult || 'no entry'}`);
          } catch {
            console.warn(`${tag}   arp: lookup failed`);
          }
        }

        if (Date.now() - startTime > timeoutMs) {
          throw new Error(
            `Timeout waiting for SSH on ${host}:${port} after ${elapsed}s (${sshAttempts} attempts, TCP open at ${phase1Elapsed}s). ` +
            `Last attempt took ${attemptDuration}s, exit=${errCode}, signal=${signal}. ` +
            `Last stage: ${lastDebugLine}. ` +
            `Errors: ${errorLines.join(' | ') || 'none'}`
          );
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  /**
   * Resize ext4 filesystems inside the guest after boot.
   * ext4 supports online resize — `resize2fs` expands the filesystem to fill the block device.
   * This is the definitive resize step; the host-side resize2fs is best-effort.
   */
  private async resizeGuestFilesystems(vmId: string, overlayDevice: string, dockerDevice: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) return;

    const sshKeyPath = this.getSshKeyPath();
    const port = vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort;
    const host = vm.networkConfig.mode === 'tap' ? vm.networkConfig.guestIp : '127.0.0.1';

    const devices = [overlayDevice];
    if (dockerDevice) devices.push(dockerDevice);

    for (const dev of devices) {
      try {
        execFileSync('ssh', [
          '-i', sshKeyPath,
          '-o', 'StrictHostKeyChecking=no',
          '-o', 'UserKnownHostsFile=/dev/null',
          '-o', 'ConnectTimeout=5',
          '-o', 'IdentitiesOnly=yes',
          `agent@${host}`,
          '-p', port!.toString(),
          `sudo resize2fs /dev/${dev} 2>/dev/null`,
        ], { stdio: 'pipe', timeout: 15000 });
        console.log(`[FirecrackerService] Guest resize2fs /dev/${dev} completed for VM ${vmId}`);
      } catch {
        // resize2fs prints "Nothing to do!" and exits 0 when already full size,
        // but may fail if the device doesn't need resizing — either way, non-fatal
        console.log(`[FirecrackerService] Guest resize2fs /dev/${dev} skipped for VM ${vmId}`);
      }
    }
  }

  /**
   * Configure hostname in /etc/hosts to avoid sudo warnings
   */
  private async configureHostname(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) return;

    const sshKeyPath = this.getSshKeyPath();
    const port = vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort;
    const host = vm.networkConfig.mode === 'tap' ? vm.networkConfig.guestIp : '127.0.0.1';
    const hostname = vm.mmdsMetadata?.instance?.hostname || vm.name;

    try {
      // Add hostname to /etc/hosts if not already present
      const hostsCmd = `grep -q "127.0.0.1.*${hostname}" /etc/hosts || echo "127.0.0.1 ${hostname}" | sudo tee -a /etc/hosts >/dev/null`;
      execFileSync('ssh', [
        '-i', sshKeyPath,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'UserKnownHostsFile=/dev/null',
        '-o', 'ConnectTimeout=5',
        '-o', 'IdentitiesOnly=yes',
        `agent@${host}`,
        '-p', port!.toString(),
        hostsCmd,
      ], { stdio: 'pipe', timeout: 10000 });
      console.log(`[FirecrackerService] Configured hostname ${hostname} in /etc/hosts`);
    } catch (error) {
      console.warn(`[FirecrackerService] Failed to configure hostname:`, error);
      // Non-fatal - sudo will still work, just with a warning
    }
  }

  /**
   * Mount attached volumes inside the guest VM
   * Volumes are configured as drives data0, data1, etc. which appear as /dev/vdc, /dev/vdd, etc.
   */
  private async mountVolumesInGuest(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm || !vm.volumes || vm.volumes.length === 0) return;

    const sshKeyPath = this.getSshKeyPath();
    const port = vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort;
    const host = vm.networkConfig.mode === 'tap' ? vm.networkConfig.guestIp : '127.0.0.1';

    // Device letters: vda=rootfs, vdb=overlay, vdc=docker, vdd=data0, vde=data1, etc.
    const deviceLetters = 'defghijklmnop'; // Starting from 'd' for first data volume (after overlay+docker)

    for (let i = 0; i < vm.volumes.length; i++) {
      const volume = vm.volumes[i];
      const deviceLetter = deviceLetters[i];
      const device = `/dev/vd${deviceLetter}`;
      const mountPath = volume.mountPath || '/mnt/data';

      console.log(`[FirecrackerService] Mounting ${device} at ${mountPath} in VM ${vmId}`);

      try {
        // Create mount directory and mount the device
        // Use sudo since agent user needs root for mounting
        const mountCmd = `sudo mkdir -p ${mountPath} && sudo mount ${device} ${mountPath} 2>/dev/null && sudo chown agent:agent ${mountPath}`;
        const sshCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o IdentitiesOnly=yes agent@${host} -p ${port} '${mountCmd}'`;

        execSync(sshCmd, { stdio: 'pipe', timeout: 30000 });
        console.log(`[FirecrackerService] Mounted ${volume.name} at ${mountPath}`);
      } catch (error) {
        console.warn(`[FirecrackerService] Failed to mount volume ${volume.name} at ${mountPath}:`, error);
        // Don't fail the VM start if mounting fails - the volume is still accessible
      }
    }
  }

  /**
   * Stop a VM
   */
  async stopVm(id: string): Promise<VmInfo> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status !== 'running' && vm.status !== 'booting' && vm.status !== 'paused' && vm.status !== 'error' && vm.status !== 'creating') {
      console.warn(`[FirecrackerService] VM ${id} is not running (status: ${vm.status})`);
      return this.vmToInfo(vm);
    }

    console.log(`[FirecrackerService] Stopping VM ${id}`);

    // Set stopping immediately and return — run graceful shutdown in background
    vm.status = 'stopping';
    await this.saveVmState(vm);
    const info = this.vmToInfo(vm);

    this.performGracefulShutdown(id).catch(err =>
      console.error(`[FirecrackerService] Background shutdown failed for VM ${id}:`, err)
    );

    return info;
  }

  /**
   * Performs the actual VM shutdown sequence in the background.
   * SSHs into the guest to run 'poweroff' so systemd stops services cleanly
   * (Docker containers, containerd, etc.), then falls back to CtrlAltDel and SIGKILL.
   */
  private async performGracefulShutdown(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) return;

    try {
      // Graceful shutdown via SSH — runs 'poweroff' inside the guest so systemd
      // stops services in order (Docker containers, containerd, etc.).
      // This prevents Docker containers with restart policies from auto-restarting on next boot.
      if (vm.guestIp && vm.pid && this.isProcessRunning(vm.pid)) {
        try {
          const sshKeyPath = this.getSshKeyPath();
          execFileSync('ssh', [
            '-i', sshKeyPath,
            '-o', 'StrictHostKeyChecking=no',
            '-o', 'UserKnownHostsFile=/dev/null',
            '-o', 'ConnectTimeout=3',
            '-o', 'BatchMode=yes',
            '-o', 'IdentitiesOnly=yes',
            `agent@${vm.guestIp}`,
            'sudo', 'poweroff',
          ], { timeout: 5000, stdio: 'ignore' });
        } catch {
          // SSH may fail (VM not fully booted, network down, etc.) — fall through to CtrlAltDel
        }

        // Wait for the guest to shut down cleanly (systemd stopping services)
        await this.waitForProcessExit(vm.pid, 15000);
      }

      // Fallback: CtrlAltDel via Firecracker API if process is still running
      if (vm.pid && this.isProcessRunning(vm.pid)) {
        if (vm.apiSocket && fs.existsSync(vm.apiSocket)) {
          try {
            await this.sendApiRequest(vm.apiSocket, 'PUT', '/actions', {
              action_type: 'SendCtrlAltDel',
            });
            await this.waitForProcessExit(vm.pid, 5000);
          } catch {
            // Guest may already be stopped
          }
        }
      }

      // Kill process if still running after graceful attempts
      if (vm.pid && this.isProcessRunning(vm.pid)) {
        try { process.kill(vm.pid, 'SIGTERM'); } catch {}
        await this.waitForProcessExit(vm.pid, 3000);
        if (this.isProcessRunning(vm.pid)) {
          console.warn(`[FirecrackerService] VM ${id} did not exit after SIGTERM, sending SIGKILL to process group`);
          this.killProcessGroup(vm.pid);
          await this.waitForProcessExit(vm.pid, 3000);
        }
      }
    } catch (error) {
      console.warn(`[FirecrackerService] Graceful shutdown failed for VM ${id}, forcing kill`);
      if (vm.pid) {
        this.killProcessGroup(vm.pid);
        await this.waitForProcessExit(vm.pid, 3000);
      }
    }

    // Also kill any orphaned processes using this VM's socket path
    if (vm.apiSocket) {
      const orphanPids = this.findFirecrackerPids(vm.apiSocket);
      for (const pid of orphanPids) {
        if (pid !== vm.pid) {
          console.warn(`[FirecrackerService] Killing orphaned Firecracker process ${pid} for VM ${id}`);
          this.killProcessGroup(pid);
        }
      }
    }

    // Clean SSH control sockets before releasing the IP (prevents stale socket reuse)
    if (vm.networkConfig.guestIp) {
      this.cleanSshControlSockets(vm.networkConfig.guestIp, 22);
    }

    // Release TAP device so it can be reused by other VMs
    if (vm.networkConfig.tapDevice) {
      console.log(`[FirecrackerService] Releasing TAP ${vm.networkConfig.tapDevice} for stopped VM ${id}`);
      await this.networkPool.releaseAsync(vm.networkConfig.tapDevice, id);
      vm.networkConfig.tapDevice = undefined;
      vm.networkConfig.guestIp = undefined;
      vm.networkConfig.mode = 'none';
      vm.guestIp = undefined;
    }

    // Compact disks in background (fire-and-forget) to reclaim sparse file space
    this.compactVmDisks(id).catch(err =>
      console.warn(`[FirecrackerService] Disk compaction failed for VM ${id}:`, err)
    );

    vm.status = 'stopped';
    vm.pid = undefined;
    vm.stoppedAt = new Date().toISOString();
    await this.saveVmState(vm);

    this.processes.delete(id);
    this.emit('vm:stopped', vm);
    console.log(`[FirecrackerService] VM ${id} stopped`);
  }

  /**
   * Compact VM disk files by zeroing free blocks and punching sparse holes.
   * Reclaims host disk space that was freed inside the guest but not returned
   * to the sparse backing file (Firecracker's virtio-blk has no DISCARD support).
   */
  private async compactVmDisks(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) return;

    const vmDir = path.join(this.config.dataDir, id);
    const diskFiles = ['overlay.ext4', 'docker-volume.ext4'];

    for (const diskFile of diskFiles) {
      const diskPath = path.join(vmDir, diskFile);
      if (!fs.existsSync(diskPath)) continue;

      try {
        // Get before size (actual blocks on disk, not apparent sparse size)
        const beforeStat = fs.statSync(diskPath);
        const beforeBytes = beforeStat.blocks * 512;

        // zerofree: zeros free blocks in the ext4 filesystem (works on unmounted files, no root needed)
        execFileSync('zerofree', [diskPath], { stdio: 'pipe', timeout: 120000 });

        // fallocate --dig-holes: converts zero-filled regions to sparse holes
        execFileSync('fallocate', ['--dig-holes', diskPath], { stdio: 'pipe', timeout: 120000 });

        const afterStat = fs.statSync(diskPath);
        const afterBytes = afterStat.blocks * 512;
        const savedMb = ((beforeBytes - afterBytes) / 1024 / 1024).toFixed(1);

        console.log(
          `[FirecrackerService] Compacted ${diskFile} for VM ${id}: ` +
          `${(beforeBytes / 1024 / 1024).toFixed(1)}MB → ${(afterBytes / 1024 / 1024).toFixed(1)}MB (saved ${savedMb}MB)`
        );
      } catch (err: any) {
        // Best-effort — don't break the stop flow
        console.warn(`[FirecrackerService] Failed to compact ${diskFile} for VM ${id}:`, err.message);
      }
    }
  }

  /**
   * Wait for a process to exit
   */
  private waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      const startTime = Date.now();

      const check = () => {
        if (!this.isProcessRunning(pid)) {
          resolve();
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          resolve();
          return;
        }

        setTimeout(check, 100);
      };

      check();
    });
  }

  /**
   * Attach a volume to a VM
   * Note: Firecracker doesn't support hot-plugging, so this requires a VM restart
   */
  async attachVolume(
    vmId: string,
    volumeConfig: { id?: string; name: string; hostPath: string; mountPath: string; readOnly?: boolean }
  ): Promise<VmInfo> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM ${vmId} not found`);
    }

    // Check if volume is already attached
    const existingIndex = vm.volumes.findIndex(v => v.name === volumeConfig.name);
    if (existingIndex !== -1) {
      throw new Error(`Volume ${volumeConfig.name} is already attached to VM ${vmId}`);
    }

    console.log(`[FirecrackerService] Attaching volume ${volumeConfig.name} to VM ${vmId}`);

    // Add volume to VM state
    vm.volumes.push({
      id: volumeConfig.id,
      name: volumeConfig.name,
      hostPath: volumeConfig.hostPath,
      mountPath: volumeConfig.mountPath,
      readOnly: volumeConfig.readOnly,
    });

    const wasRunning = vm.status === 'running' || vm.status === 'booting';

    // If VM is running, we need to restart it for the drive to be configured
    if (wasRunning) {
      console.log(`[FirecrackerService] Restarting VM ${vmId} to attach volume`);
      await this.stopVm(vmId);
      await this.startVm(vmId);
    } else {
      // Just save the state - volume will be configured on next start
      await this.saveVmState(vm);
    }

    this.emit('vm:volume-attached', { vmId, volumeName: volumeConfig.name });
    return this.vmToInfo(this.vms.get(vmId)!);
  }

  /**
   * Detach a volume from a VM
   * Note: Firecracker doesn't support hot-unplugging, so this requires a VM restart
   */
  async detachVolume(vmId: string, volumeName: string): Promise<VmInfo> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM ${vmId} not found`);
    }

    const volumeIndex = vm.volumes.findIndex(v => v.name === volumeName);
    if (volumeIndex === -1) {
      throw new Error(`Volume ${volumeName} is not attached to VM ${vmId}`);
    }

    console.log(`[FirecrackerService] Detaching volume ${volumeName} from VM ${vmId}`);

    // Remove volume from VM state
    vm.volumes.splice(volumeIndex, 1);

    const wasRunning = vm.status === 'running' || vm.status === 'booting';

    // If VM is running, we need to restart it for the drive to be removed
    if (wasRunning) {
      console.log(`[FirecrackerService] Restarting VM ${vmId} to detach volume`);
      await this.stopVm(vmId);
      await this.startVm(vmId);
    } else {
      // Just save the state
      await this.saveVmState(vm);
    }

    this.emit('vm:volume-detached', { vmId, volumeName });
    return this.vmToInfo(this.vms.get(vmId)!);
  }

  /**
   * Delete a VM
   */
  async deleteVm(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    console.log(`[FirecrackerService] Deleting VM ${id}`);

    // Stop if running
    if (vm.status === 'running' || vm.status === 'booting' || vm.status === 'creating') {
      await this.stopVm(id);
    }

    // Release SSH port
    this.releaseSshPort(vm.sshPort);

    // Release TAP device
    if (vm.networkConfig.tapDevice) {
      await this.networkPool.releaseAsync(vm.networkConfig.tapDevice, id);
    }

    // Delete VM directory (includes overlay.ext4 which is the only per-VM disk file)
    const vmDir = path.join(this.config.dataDir, id);
    if (fs.existsSync(vmDir)) {
      fs.rmSync(vmDir, { recursive: true, force: true });
    }

    this.vms.delete(id);
    this.emit('vm:deleted', { id });
    console.log(`[FirecrackerService] VM ${id} deleted`);
  }

  /**
   * Pause a running VM
   */
  async pauseVm(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status !== 'running') {
      throw new Error(`VM ${id} is not running (status: ${vm.status})`);
    }

    if (!vm.apiSocket || !fs.existsSync(vm.apiSocket)) {
      throw new Error(`VM ${id} has no API socket`);
    }

    await this.sendApiRequest(vm.apiSocket, 'PATCH', '/vm', { state: 'Paused' });

    vm.status = 'paused';
    await this.saveVmState(vm);
    console.log(`[FirecrackerService] VM ${id} paused`);
  }

  /**
   * Resume a paused VM
   */
  async resumeVm(id: string): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status !== 'paused') {
      throw new Error(`VM ${id} is not paused (status: ${vm.status})`);
    }

    if (!vm.apiSocket || !fs.existsSync(vm.apiSocket)) {
      throw new Error(`VM ${id} has no API socket`);
    }

    await this.sendApiRequest(vm.apiSocket, 'PATCH', '/vm', { state: 'Resumed' });

    vm.status = 'running';
    await this.saveVmState(vm);
    console.log(`[FirecrackerService] VM ${id} resumed`);
  }

  /**
   * Update MMDS metadata for a VM
   * This is the key feature for golden image restore - update identity before resuming
   */
  async setMmdsMetadata(id: string, metadata: MmdsMetadata): Promise<void> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (!vm.apiSocket || !fs.existsSync(vm.apiSocket)) {
      throw new Error(`VM ${id} has no API socket`);
    }

    await this.sendApiRequest(vm.apiSocket, 'PUT', '/mmds', metadata);
    vm.mmdsMetadata = metadata;
    await this.saveVmState(vm);
    console.log(`[FirecrackerService] Updated MMDS for VM ${id}`);
  }

  /**
   * Create a snapshot of a VM.
   *
   * The VM is paused only for the Firecracker state+memory snapshot (sub-second),
   * then immediately resumed. The disk copy runs in the background — the snapshot
   * is returned with `diskReady: false` and the metadata file is updated to
   * `diskReady: true` once the copy finishes. Rollback/clone check this flag.
   */
  async createSnapshot(id: string, name: string): Promise<FirecrackerSnapshotInfo> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    const vmDir = path.join(this.config.dataDir, id);
    const snapshotsDir = path.join(vmDir, 'snapshots');
    const snapshotId = `snap-${Date.now()}`;
    const snapshotDir = path.join(snapshotsDir, snapshotId);

    fs.mkdirSync(snapshotDir, { recursive: true });

    const snapshotPath = path.join(snapshotDir, 'snapshot.bin');
    const memFilePath = path.join(snapshotDir, 'mem.bin');
    const diskPath = path.join(snapshotDir, 'rootfs.ext4');

    // Pause → snapshot → resume: keep the pause window as short as possible
    const wasRunning = vm.status === 'running';
    vm.statusMessage = 'Snapshotting: capturing VM state…';
    if (wasRunning) {
      await this.pauseVm(id);
    }

    try {
      // Create snapshot via Firecracker API (captures CPU state + memory)
      await this.sendApiRequest(vm.apiSocket!, 'PUT', '/snapshot/create', {
        snapshot_type: 'Full',
        snapshot_path: snapshotPath,
        mem_file_path: memFilePath,
      } as SnapshotCreateParams);
    } finally {
      // Resume immediately — disk copy happens in the background
      if (wasRunning) {
        await this.resumeVm(id);
      }
    }

    vm.statusMessage = 'Snapshotting: copying disk in background…';

    // Save metadata with diskReady: false (disk copy pending)
    const snapshotInfo: FirecrackerSnapshotInfo = {
      id: snapshotId,
      vmId: id,
      name,
      baseImage: vm.baseImage,
      snapshotPath,
      memFilePath,
      diskPath,
      mmdsMetadata: vm.mmdsMetadata!,
      vcpus: vm.vcpus,
      memoryMb: vm.memoryMb,
      diskGb: vm.diskGb,
      createdAt: new Date().toISOString(),
      diskReady: false,
    };

    const metadataPath = path.join(snapshotDir, 'metadata.json');
    fs.writeFileSync(metadataPath, JSON.stringify(snapshotInfo, null, 2));

    // Background disk copy — overlay.ext4 is a sparse file, cp --sparse=always
    // avoids copying hole regions. The snapshot's memory image pins the consistent
    // disk state; post-resume writes won't affect the snapshot's restore semantics
    // because memory restore rewinds the guest to the snapshot point.
    const vmDiskPath = path.join(vmDir, 'overlay.ext4');
    if (fs.existsSync(vmDiskPath)) {
      const copyProc = spawn('cp', ['--sparse=always', '--reflink=auto', vmDiskPath, diskPath], { stdio: 'ignore' });
      copyProc.on('close', (code) => {
        if (code === 0) {
          snapshotInfo.diskReady = true;
          fs.writeFileSync(metadataPath, JSON.stringify(snapshotInfo, null, 2));
          console.log(`[FirecrackerService] Snapshot ${snapshotId} disk copy complete`);
        } else {
          console.error(`[FirecrackerService] Snapshot ${snapshotId} disk copy failed (exit ${code})`);
        }
        vm.statusMessage = undefined;
      });
      copyProc.on('error', (err) => {
        console.error(`[FirecrackerService] Snapshot ${snapshotId} disk copy error:`, err);
        vm.statusMessage = undefined;
      });
    } else {
      // No overlay disk — mark as ready immediately
      snapshotInfo.diskReady = true;
      fs.writeFileSync(metadataPath, JSON.stringify(snapshotInfo, null, 2));
      vm.statusMessage = undefined;
      console.warn(`[FirecrackerService] VM disk not found at ${vmDiskPath}`);
    }

    console.log(`[FirecrackerService] Created snapshot ${snapshotId} for VM ${id} (disk copy in background)`);
    return snapshotInfo;
  }

  /**
   * Rollback a VM to a previous snapshot state (same VM, memory restore)
   * This restores the SAME VM to its exact state when the snapshot was taken.
   * The VM must be stopped before rollback.
   */
  async rollbackToSnapshot(vmId: string, snapshotId: string): Promise<VmInfo> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM ${vmId} not found`);
    }

    if (vm.status === 'running') {
      throw new Error('VM must be stopped before rollback. Stop the VM first.');
    }

    const vmDir = path.join(this.config.dataDir, vmId);
    const snapshotDir = path.join(vmDir, 'snapshots', snapshotId);
    const metadataPath = path.join(snapshotDir, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const snapshotMeta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as FirecrackerSnapshotInfo;

    if (snapshotMeta.diskReady === false) {
      throw new Error('Snapshot disk copy is still in progress. Please wait and try again.');
    }

    console.log(`[FirecrackerService] Rolling back VM ${vmId} to snapshot ${snapshotId}`);

    // Restore the overlay disk from snapshot
    const overlayPath = path.join(vmDir, 'overlay.ext4');
    if (fs.existsSync(snapshotMeta.diskPath)) {
      execSync(`cp --sparse=always "${snapshotMeta.diskPath}" "${overlayPath}"`, { stdio: 'pipe' });
    } else {
      throw new Error(`Snapshot disk not found: ${snapshotMeta.diskPath}`);
    }

    // Copy snapshot files for memory restore
    const snapshotPath = path.join(vmDir, 'snapshot.bin');
    const memFilePath = path.join(vmDir, 'mem.bin');
    fs.copyFileSync(snapshotMeta.snapshotPath, snapshotPath);
    fs.copyFileSync(snapshotMeta.memFilePath, memFilePath);

    // Mark VM as ready to start (will use snapshot restore on next start)
    vm.sourceSnapshot = {
      vmId: snapshotMeta.vmId,
      snapshotId: snapshotMeta.id,
      snapshotDir,
    };
    vm.status = 'stopped';
    await this.saveVmState(vm);

    console.log(`[FirecrackerService] VM ${vmId} rolled back to snapshot ${snapshotId}. Start VM to resume.`);

    return this.vmToInfo(vm);
  }

  /**
   * Clone a VM from a snapshot - creates a NEW independent VM with fresh boot
   * The new VM boots fresh but has all the disk contents from the snapshot.
   * This is like using the snapshot as a "base image" for a new VM.
   */
  async cloneFromSnapshot(
    snapshotDir: string,
    newConfig: { name: string }
  ): Promise<VmInfo> {
    console.log(`[FirecrackerService] Cloning new VM from snapshot: ${snapshotDir}`);

    const metadataPath = path.join(snapshotDir, 'metadata.json');
    if (!fs.existsSync(metadataPath)) {
      throw new Error('Snapshot metadata not found');
    }

    const snapshotMeta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as FirecrackerSnapshotInfo;

    if (snapshotMeta.diskReady === false) {
      throw new Error('Snapshot disk copy is still in progress. Please wait and try again.');
    }

    // Check snapshot disk exists
    if (!fs.existsSync(snapshotMeta.diskPath)) {
      throw new Error(`Snapshot disk not found: ${snapshotMeta.diskPath}. Please take a new snapshot.`);
    }

    // Create a new VM with the snapshot's configuration
    // but DON'T use memory restore - boot fresh with the snapshot's disk
    const id = this.generateVmId();
    const sshPort = this.allocateSshPort();
    const vmDir = path.join(this.config.dataDir, id);

    fs.mkdirSync(vmDir, { recursive: true });

    // Copy the snapshot's overlay disk as this VM's starting overlay
    // This gives us the installed packages without memory state
    const overlayPath = path.join(vmDir, 'overlay.ext4');
    execSync(`cp --sparse=always "${snapshotMeta.diskPath}" "${overlayPath}"`, { stdio: 'pipe' });

    // Allocate network
    let tapAllocation: TapAllocation | null = null;
    let networkMode: 'tap' | 'none' = 'none';

    try {
      const status = this.networkPool.checkHealth();
      const poolMode = this.networkPool.getMode();

      if (poolMode === 'helper' || (status.healthy && status.availableTaps > 0)) {
        tapAllocation = await this.networkPool.allocateAsync(id);
        networkMode = 'tap';
        console.log(`[FirecrackerService] Allocated TAP ${tapAllocation.tapName} for cloned VM ${id}`);
      }
    } catch (error) {
      console.warn(`[FirecrackerService] Failed to allocate TAP for cloned VM ${id}:`, error);
    }

    // Build MMDS metadata
    const sshPubKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519.pub');
    const sshPublicKey = fs.existsSync(sshPubKeyPath)
      ? fs.readFileSync(sshPubKeyPath, 'utf-8').trim()
      : '';

    const mmdsMetadata: MmdsMetadata = {
      instance: {
        id,
        name: newConfig.name,
        hostname: newConfig.name,
      },
      network: {
        interfaces: {
          eth0: {
            mac: tapAllocation?.macAddress || this.generateMacAddress(),
            ipv4: {
              address: tapAllocation?.guestIp || '0.0.0.0',
              netmask: '255.255.255.0',
              gateway: tapAllocation?.gateway || '0.0.0.0',
            },
          },
        },
        dns: ['8.8.8.8', '8.8.4.4'],
      },
      ssh: {
        authorized_keys: sshPublicKey ? [sshPublicKey] : [],
      },
    };

    // Create VM state - this is a FRESH VM that will boot normally
    const vm: FirecrackerVmState = {
      id,
      name: newConfig.name,
      status: 'stopped',  // Start as stopped, will boot fresh
      sshPort,
      guestIp: tapAllocation?.guestIp,
      networkConfig: {
        mode: networkMode,
        tapDevice: tapAllocation?.tapName,
        bridgeName: tapAllocation?.bridgeName,
        macAddress: mmdsMetadata.network.interfaces.eth0.mac,
        guestIp: tapAllocation?.guestIp,
        gateway: tapAllocation?.gateway,
      },
      portMappings: [],
      baseImage: snapshotMeta.baseImage,
      vcpus: snapshotMeta.vcpus,
      memoryMb: snapshotMeta.memoryMb,
      diskGb: snapshotMeta.diskGb,
      volumes: [],
      mmdsMetadata,
      sourceSnapshot: {
        vmId: snapshotMeta.vmId,
        snapshotId: snapshotMeta.id,
        snapshotDir,
      },
      createdAt: new Date().toISOString(),
    };

    this.vms.set(id, vm);
    await this.saveVmState(vm);

    console.log(`[FirecrackerService] Created cloned VM ${id} from snapshot. Starting...`);

    // Start the VM with fresh boot (not memory restore)
    return this.startVm(id);
  }

  /**
   * Promote a snapshot to a base image using layered storage.
   *
   * Instead of copying the full disk, this creates a layered image that:
   * - References the parent base image
   * - Stores only the overlay diff (much smaller, typically ~100MB vs ~2.5GB)
   *
   * When a VM is created from a layered image, the overlay-init script
   * sets up multi-layer overlayfs: base -> parent-layer -> vm-overlay
   */
  async promoteSnapshotToImage(
    vmId: string,
    snapshotId: string,
    newImageName: string
  ): Promise<{ imageName: string; imagePath: string }> {
    const vmDir = path.join(this.config.dataDir, vmId);
    const snapshotDir = path.join(vmDir, 'snapshots', snapshotId);
    const metadataPath = path.join(snapshotDir, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const snapshotMeta = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as FirecrackerSnapshotInfo;

    if (!fs.existsSync(snapshotMeta.diskPath)) {
      throw new Error(`Snapshot disk not found: ${snapshotMeta.diskPath}`);
    }

    console.log(`[FirecrackerService] Promoting snapshot ${snapshotId} to layered base image: ${newImageName}`);

    // Create new image directory
    const newImageDir = path.join(this.config.baseImagesDir, newImageName);
    if (fs.existsSync(newImageDir)) {
      throw new Error(`Image ${newImageName} already exists`);
    }
    fs.mkdirSync(newImageDir, { recursive: true });

    // Get the original base image (normalize name for filesystem path)
    const normalizedParentName = this.normalizeImageName(snapshotMeta.baseImage);
    const parentImageDir = path.join(this.config.baseImagesDir, normalizedParentName);
    const parentKernel = path.join(parentImageDir, 'vmlinux');

    // Symlink to parent's kernel (saves disk space)
    const newKernel = path.join(newImageDir, 'vmlinux');
    fs.symlinkSync(parentKernel, newKernel);

    // Copy the overlay as the layer diff (sparse copy to minimize disk usage)
    // This file contains only the changes from the parent image
    const layerPath = path.join(newImageDir, 'layer.ext4');
    execSync(`cp --sparse=always "${snapshotMeta.diskPath}" "${layerPath}"`, { stdio: 'pipe' });

    // Clean the ext4 journal - snapshot was taken from a running VM so the
    // filesystem may have an unclean journal. Without this, mounting read-only
    // would fail with "recovery required on readonly filesystem".
    try {
      execSync(`e2fsck -y -f "${layerPath}"`, { stdio: 'pipe' });
      console.log(`[FirecrackerService] Cleaned ext4 journal on layer`);
    } catch (error) {
      // e2fsck returns non-zero if it made changes, which is expected
      console.log(`[FirecrackerService] e2fsck completed (may have fixed journal)`);
    }

    // Get actual size of the layer file
    const layerStats = fs.statSync(layerPath);
    const layerSizeMB = Math.round(layerStats.blocks * 512 / 1024 / 1024); // blocks are 512 bytes

    // Create layer metadata file
    const layerMeta = {
      parent: snapshotMeta.baseImage,
      parentNormalized: normalizedParentName,
      createdAt: new Date().toISOString(),
      sourceVmId: vmId,
      sourceSnapshotId: snapshotId,
      layerSizeMB,
    };
    fs.writeFileSync(
      path.join(newImageDir, 'layer.json'),
      JSON.stringify(layerMeta, null, 2)
    );

    console.log(`[FirecrackerService] Created layered base image: ${newImageName}`);
    console.log(`[FirecrackerService]   Parent: ${snapshotMeta.baseImage}`);
    console.log(`[FirecrackerService]   Layer size: ${layerSizeMB}MB (actual disk usage)`);
    console.log(`[FirecrackerService]   Kernel: symlinked to parent`);

    return {
      imageName: newImageName,
      imagePath: newImageDir,
    };
  }

  /**
   * Check if an image is a layered image (has layer.json)
   */
  private isLayeredImage(imageName: string): boolean {
    const normalizedName = this.normalizeImageName(imageName);
    const imageDir = path.join(this.config.baseImagesDir, normalizedName);
    return fs.existsSync(path.join(imageDir, 'layer.json'));
  }

  /**
   * Get the layer chain for an image (resolves parent references)
   * Returns array from root base image to the requested image
   */
  private getImageLayerChain(imageName: string): string[] {
    const chain: string[] = [];
    let currentImage = imageName;

    while (currentImage) {
      chain.unshift(currentImage); // Add to front

      const normalizedName = this.normalizeImageName(currentImage);
      const layerJsonPath = path.join(this.config.baseImagesDir, normalizedName, 'layer.json');

      if (fs.existsSync(layerJsonPath)) {
        const layerMeta = JSON.parse(fs.readFileSync(layerJsonPath, 'utf-8'));
        currentImage = layerMeta.parent;
      } else {
        // This is the root base image
        break;
      }
    }

    return chain;
  }

  /**
   * Get a VM by ID
   */
  getVm(id: string): VmInfo | null {
    const vm = this.vms.get(id);
    return vm ? this.vmToInfo(vm) : null;
  }

  /**
   * List all VMs
   */
  listVms(): VmInfo[] {
    return Array.from(this.vms.values()).map(vm => this.vmToInfo(vm));
  }

  /**
   * Update port shortcuts for a VM
   * These are just UI shortcuts - all VM ports are directly accessible via the guest IP
   */
  updateVmPorts(id: string, ports: Array<{ container: number; host: number }>): VmInfo {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    vm.portMappings = ports.map(p => ({
      container: p.container,
      host: p.host,
      protocol: 'tcp' as const,
    }));

    // Save state synchronously (fire and forget the async version)
    this.saveVmState(vm).catch(err => {
      console.error(`[FirecrackerService] Failed to save VM state after port update:`, err);
    });

    return this.vmToInfo(vm);
  }

  /**
   * Rename a VM
   */
  renameVm(id: string, newName: string): VmInfo {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    // Validate name
    if (!newName || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(newName)) {
      throw new Error('VM name must start with alphanumeric and contain only alphanumeric, underscore, period, or hyphen');
    }

    // Check for name uniqueness
    for (const existingVm of this.vms.values()) {
      if (existingVm.id !== id && existingVm.name === newName) {
        throw new Error(`A VM with name '${newName}' already exists`);
      }
    }

    const oldName = vm.name;
    vm.name = newName;

    // Update MMDS metadata if present
    if (vm.mmdsMetadata?.instance) {
      vm.mmdsMetadata.instance.name = newName;
      vm.mmdsMetadata.instance.hostname = newName;
    }

    // Save state synchronously (fire and forget the async version)
    this.saveVmState(vm).catch(err => {
      console.error(`[FirecrackerService] Failed to save VM state after rename:`, err);
    });

    // If VM is running, update hostname inside the guest
    if (vm.status === 'running') {
      this.updateGuestHostname(id, oldName, newName).catch(err => {
        console.warn(`[FirecrackerService] Failed to update guest hostname:`, err);
      });
    }

    this.emit('vm:renamed', { id, newName });
    console.log(`[FirecrackerService] VM ${id} renamed to ${newName}`);

    return this.vmToInfo(vm);
  }

  /**
   * Update VM resource configuration (vCPUs, memory, disk).
   * VM must be stopped. Changes take effect on next boot.
   */
  async updateVmResources(id: string, resources: { vcpus?: number; memoryMb?: number; diskGb?: number }): Promise<VmInfo> {
    const vm = this.vms.get(id);
    if (!vm) {
      throw new Error(`VM ${id} not found`);
    }

    if (vm.status !== 'stopped' && vm.status !== 'error') {
      throw new Error(`VM must be stopped to reconfigure resources (current status: ${vm.status})`);
    }

    if (resources.vcpus !== undefined) {
      if (resources.vcpus < 1 || resources.vcpus > 32) throw new Error('vCPUs must be between 1 and 32');
      vm.vcpus = resources.vcpus;
    }
    if (resources.memoryMb !== undefined) {
      if (resources.memoryMb < 128 || resources.memoryMb > 65536) throw new Error('Memory must be between 128 MB and 64 GB');
      vm.memoryMb = resources.memoryMb;
    }
    if (resources.diskGb !== undefined) {
      if (resources.diskGb < 1 || resources.diskGb > 1000) throw new Error('Disk must be between 1 and 1000 GB');
      if (resources.diskGb < vm.diskGb) throw new Error('Disk size cannot be reduced');
      vm.diskGb = resources.diskGb;
    }

    await this.saveVmState(vm);
    this.emit('vm:reconfigured', { id, resources });
    console.log(`[FirecrackerService] VM ${id} resources updated: vcpus=${vm.vcpus}, memoryMb=${vm.memoryMb}, diskGb=${vm.diskGb}`);

    return this.vmToInfo(vm);
  }

  /**
   * Update hostname inside a running VM
   */
  private async updateGuestHostname(vmId: string, oldName: string, newName: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm || vm.status !== 'running') return;

    const sshKeyPath = this.getSshKeyPath();
    const port = vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort;
    const host = vm.networkConfig.mode === 'tap' ? vm.networkConfig.guestIp : '127.0.0.1';

    if (!host) return;

    try {
      // Update /etc/hosts: remove old hostname entry and add new one
      const hostsCmd = `sudo sed -i 's/127.0.0.1.*${oldName}/127.0.0.1 ${newName}/g' /etc/hosts; grep -q "127.0.0.1.*${newName}" /etc/hosts || echo "127.0.0.1 ${newName}" | sudo tee -a /etc/hosts >/dev/null`;

      // Also set the hostname using hostnamectl if available
      const hostnameCmd = `command -v hostnamectl >/dev/null && sudo hostnamectl set-hostname ${newName} || sudo hostname ${newName}`;

      const fullCmd = `${hostsCmd} && ${hostnameCmd}`;
      const sshCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -o IdentitiesOnly=yes agent@${host} -p ${port} '${fullCmd}'`;

      execSync(sshCmd, { stdio: 'pipe', timeout: 15000 });
      console.log(`[FirecrackerService] Updated guest hostname from ${oldName} to ${newName}`);
    } catch (error) {
      console.warn(`[FirecrackerService] Failed to update guest hostname:`, error);
      // Non-fatal - the rename still worked at the VM level
    }
  }

  /**
   * Get SSH connection info for a VM
   */
  getSshInfo(id: string): { host: string; port: number; user: string; command: string } | null {
    const vm = this.vms.get(id);
    if (!vm) return null;

    const privateKeyPath = path.join(this.config.sshKeysDir, 'id_ed25519');
    const user = 'agent';

    if (vm.networkConfig.guestIp && vm.networkConfig.mode === 'tap') {
      const host = vm.networkConfig.guestIp;
      const port = 22;
      return {
        host,
        port,
        user,
        command: `ssh -i ${privateKeyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${user}@${host}`,
      };
    }

    const host = '127.0.0.1';
    const port = vm.sshPort;
    return {
      host,
      port,
      user,
      command: `ssh -i ${privateKeyPath} -p ${port} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${user}@${host}`,
    };
  }

  /**
   * Get SSH private key path
   */
  getSshKeyPath(): string {
    return path.join(this.config.sshKeysDir, 'id_ed25519');
  }

  /**
   * Get SSH private key content
   */
  getSshPrivateKey(): string | null {
    const keyPath = this.getSshKeyPath();
    if (fs.existsSync(keyPath)) {
      return fs.readFileSync(keyPath, 'utf-8');
    }
    return null;
  }

  /**
   * Read the current SSH public key
   */
  private readSshPublicKey(): string | null {
    const pubKeyPath = this.getSshKeyPath() + '.pub';
    if (fs.existsSync(pubKeyPath)) {
      return fs.readFileSync(pubKeyPath, 'utf-8').trim();
    }
    return null;
  }

  /**
   * Get VM boot logs from firecracker.log
   */
  getVmBootLogs(vmId: string, lines: number = 100): string | null {
    const vm = this.vms.get(vmId);
    if (!vm) {
      return null;
    }

    const vmDir = path.join(this.config.dataDir, vmId);
    const logFile = path.join(vmDir, 'firecracker.log');

    if (!fs.existsSync(logFile)) {
      return '';
    }

    try {
      const content = fs.readFileSync(logFile, 'utf-8');
      const logLines = content.split('\n');
      return logLines.slice(-lines).join('\n');
    } catch (error) {
      return null;
    }
  }

  /**
   * Get the path to a VM's log file
   */
  getVmLogPath(vmId: string): string | undefined {
    const vm = this.vms.get(vmId);
    if (!vm) {
      return undefined;
    }
    return path.join(this.config.dataDir, vmId, 'firecracker.log');
  }

  /**
   * List files in a VM directory via SSH
   */
  async listVmFiles(vmId: string, dirPath: string): Promise<{ name: string; type: 'file' | 'directory'; size: number; modified: string }[]> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM ${vmId} not found`);
    }

    if (vm.status !== 'running') {
      throw new Error(`VM ${vmId} is not running`);
    }

    const sshKeyPath = this.getSshKeyPath();
    const host = vm.networkConfig.guestIp || '127.0.0.1';
    const port = vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort;
    const user = 'agent';

    // Use ls -la with specific format for parsing
    const sshCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o IdentitiesOnly=yes ${user}@${host} -p ${port} "ls -la --time-style=long-iso '${dirPath.replace(/'/g, "'\\''")}'"`;

    try {
      const output = execSync(sshCmd, { encoding: 'utf-8', timeout: 30000 });
      const lines = output.trim().split('\n').slice(1); // Skip "total X" line

      const files: { name: string; type: 'file' | 'directory'; size: number; modified: string }[] = [];

      for (const line of lines) {
        // Parse: drwxr-xr-x 2 agent agent 4096 2024-01-15 10:30 dirname
        const parts = line.trim().split(/\s+/);
        if (parts.length < 8) continue;

        const permissions = parts[0];
        const size = parseInt(parts[4], 10) || 0;
        const date = parts[5];
        const time = parts[6];
        const name = parts.slice(7).join(' ');

        if (name === '.' || name === '..') continue;

        files.push({
          name,
          type: permissions.startsWith('d') ? 'directory' : 'file',
          size,
          modified: `${date} ${time}`,
        });
      }

      return files;
    } catch (error) {
      throw new Error(`Failed to list files: ${error}`);
    }
  }

  /**
   * Upload a file to a VM via SCP
   */
  async uploadFileToVm(vmId: string, fileName: string, content: Buffer, destPath: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM ${vmId} not found`);
    }

    if (vm.status !== 'running') {
      throw new Error(`VM ${vmId} is not running`);
    }

    const sshKeyPath = this.getSshKeyPath();
    const host = vm.networkConfig.guestIp || '127.0.0.1';
    const port = vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort;
    const user = 'agent';

    // Write content to temp file
    const tmpFile = path.join(os.tmpdir(), `vm-upload-${Date.now()}-${fileName}`);
    fs.writeFileSync(tmpFile, content);

    try {
      const scpCmd = `scp -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o ConnectTimeout=5 -o BatchMode=yes -P ${port} "${tmpFile}" ${user}@${host}:"${destPath}/${fileName}"`;
      execSync(scpCmd, { timeout: 60000 });
    } finally {
      // Clean up temp file
      fs.unlinkSync(tmpFile);
    }
  }

  /**
   * Download a file from a VM via SCP
   */
  async downloadFileFromVm(vmId: string, filePath: string): Promise<Buffer> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM ${vmId} not found`);
    }

    if (vm.status !== 'running') {
      throw new Error(`VM ${vmId} is not running`);
    }

    const sshKeyPath = this.getSshKeyPath();
    const host = vm.networkConfig.guestIp || '127.0.0.1';
    const port = vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort;
    const user = 'agent';

    // Download to temp file
    const tmpFile = path.join(os.tmpdir(), `vm-download-${Date.now()}`);

    try {
      execFileSync('scp', ['-i', sshKeyPath, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes', '-P', String(port), `${user}@${host}:'${filePath}'`, tmpFile], { timeout: 30000 });

      const content = fs.readFileSync(tmpFile);
      return content;
    } finally {
      // Clean up temp file
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile);
      }
    }
  }

  /**
   * Delete a file in a VM via SSH
   */
  async deleteVmFile(vmId: string, filePath: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM ${vmId} not found`);
    }

    if (vm.status !== 'running') {
      throw new Error(`VM ${vmId} is not running`);
    }

    const sshKeyPath = this.getSshKeyPath();
    const host = vm.networkConfig.guestIp || '127.0.0.1';
    const port = vm.networkConfig.mode === 'tap' ? 22 : vm.sshPort;
    const user = 'agent';

    const sshCmd = `ssh -i ${sshKeyPath} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 -o IdentitiesOnly=yes ${user}@${host} -p ${port} "rm -rf '${filePath.replace(/'/g, "'\\''")}'"`;

    execSync(sshCmd, { timeout: 30000 });
  }

  /**
   * List snapshots for a VM
   */
  listVmSnapshots(id: string): FirecrackerSnapshotInfo[] {
    const vm = this.vms.get(id);
    if (!vm) return [];

    const vmDir = path.join(this.config.dataDir, id);
    const snapshotsDir = path.join(vmDir, 'snapshots');

    if (!fs.existsSync(snapshotsDir)) return [];

    const snapshots: FirecrackerSnapshotInfo[] = [];
    const snapshotDirs = fs.readdirSync(snapshotsDir);

    for (const snapshotId of snapshotDirs) {
      const snapshotDir = path.join(snapshotsDir, snapshotId);
      const metadataPath = path.join(snapshotDir, 'metadata.json');

      if (!fs.existsSync(metadataPath)) continue;

      try {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as FirecrackerSnapshotInfo;
        snapshots.push(metadata);
      } catch (e) {
        console.error(`[FirecrackerService] Failed to read snapshot ${snapshotId}:`, e);
      }
    }

    return snapshots.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  /**
   * Delete a snapshot
   */
  deleteVmSnapshot(vmId: string, snapshotId: string): void {
    const vmDir = path.join(this.config.dataDir, vmId);
    const snapshotDir = path.join(vmDir, 'snapshots', snapshotId);

    if (!fs.existsSync(snapshotDir)) {
      throw new Error(`Snapshot ${snapshotId} not found for VM ${vmId}`);
    }

    // Remove the snapshot directory recursively
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    console.log(`[FirecrackerService] Deleted snapshot ${snapshotId} for VM ${vmId}`);
  }

  /**
   * Convert internal state to API VmInfo
   */
  private vmToInfo(vm: FirecrackerVmState): VmInfo {
    const sshInfo = this.getSshInfo(vm.id);

    return {
      id: vm.id,
      name: vm.name,
      status: vm.status,
      state: vm.status,
      hypervisor: 'firecracker',
      sshHost: sshInfo?.host || '127.0.0.1',
      sshPort: sshInfo?.port || vm.sshPort,
      sshUser: sshInfo?.user || 'agent',
      sshCommand: sshInfo?.command,
      guestIp: vm.networkConfig.guestIp,
      networkMode: vm.networkConfig.mode,
      ports: vm.portMappings,
      volumes: vm.volumes,
      image: vm.baseImage,
      vcpus: vm.vcpus,
      memoryMb: vm.memoryMb,
      diskGb: vm.diskGb,
      createdAt: vm.createdAt,
      startedAt: vm.startedAt,
      error: vm.error,
      statusMessage: vm.statusMessage,
    };
  }

  /**
   * Get service stats
   */
  getStats(): { total: number; running: number; stopped: number; error: number } {
    let total = 0;
    let running = 0;
    let stopped = 0;
    let error = 0;

    for (const vm of this.vms.values()) {
      total++;
      switch (vm.status) {
        case 'running':
          running++;
          break;
        case 'stopped':
        case 'creating':
          stopped++;
          break;
        case 'error':
          error++;
          break;
      }
    }

    return { total, running, stopped, error };
  }

  /**
   * Shutdown all VMs and cleanup
   */
  async shutdown(): Promise<void> {
    console.log('[FirecrackerService] Shutting down...');

    for (const [id, vm] of this.vms) {
      if (vm.status === 'running') {
        try {
          await this.stopVm(id);
        } catch (error) {
          console.error(`[FirecrackerService] Failed to stop VM ${id}:`, error);
        }
      }
    }

    this.emit('firecracker:shutdown');
    console.log('[FirecrackerService] Shutdown complete');
  }

  /**
   * Get network status
   */
  getNetworkStatus() {
    return this.networkPool.checkHealth();
  }

  /**
   * List available base images
   * Includes both root base images (with rootfs.ext4) and layered images (with layer.ext4)
   */
  listBaseImages(): { name: string; hasFirecrackerImage: boolean; isLayered?: boolean; parent?: string; layerSizeMB?: number }[] {
    const baseImagesDir = this.config.baseImagesDir;
    if (!fs.existsSync(baseImagesDir)) {
      return [];
    }

    const images: { name: string; hasFirecrackerImage: boolean; isLayered?: boolean; parent?: string; layerSizeMB?: number }[] = [];
    const entries = fs.readdirSync(baseImagesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const imageDir = path.join(baseImagesDir, entry.name);
      const layerJsonPath = path.join(imageDir, 'layer.json');

      // Check for root base image (has rootfs.ext4 + vmlinux)
      const isRootBaseImage = fs.existsSync(path.join(imageDir, 'rootfs.ext4')) &&
                              fs.existsSync(path.join(imageDir, 'vmlinux'));

      // Check for layered image (has layer.ext4 + layer.json + vmlinux)
      const isLayeredImage = fs.existsSync(path.join(imageDir, 'layer.ext4')) &&
                             fs.existsSync(layerJsonPath) &&
                             fs.existsSync(path.join(imageDir, 'vmlinux'));

      const hasFirecrackerImage = isRootBaseImage || isLayeredImage;

      if (hasFirecrackerImage) {
        const imageInfo: { name: string; hasFirecrackerImage: boolean; isLayered?: boolean; parent?: string; layerSizeMB?: number } = {
          name: entry.name,
          hasFirecrackerImage: true,
        };

        // Add layer info for layered images
        if (isLayeredImage) {
          try {
            const layerMeta = JSON.parse(fs.readFileSync(layerJsonPath, 'utf-8'));
            imageInfo.isLayered = true;
            imageInfo.parent = layerMeta.parent;
            imageInfo.layerSizeMB = layerMeta.layerSizeMB;
          } catch (e) {
            console.error(`Failed to parse layer.json for ${entry.name}:`, e);
          }
        }

        images.push(imageInfo);
      } else {
        images.push({
          name: entry.name,
          hasFirecrackerImage: false,
        });
      }
    }

    return images;
  }
}

// Singleton instance
let firecrackerService: FirecrackerService | null = null;

export function getFirecrackerService(): FirecrackerService {
  if (!firecrackerService) {
    firecrackerService = new FirecrackerService();
  }
  return firecrackerService;
}

export async function initializeFirecrackerService(): Promise<FirecrackerService> {
  const service = getFirecrackerService();
  await service.initialize();
  return service;
}
