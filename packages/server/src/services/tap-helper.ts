/**
 * TapHelper - On-demand TAP Device Management
 *
 * Uses the handler-tap-helper binary (with CAP_NET_ADMIN capability)
 * to create and delete TAP devices without requiring root privileges
 * for the main application.
 *
 * Installation: sudo ./scripts/user/install-tap-helper.sh --setup-bridge
 */

import { spawn, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Result from TAP creation */
export interface TapCreateResult {
  success: boolean;
  tapName: string;
  error?: string;
}

/** TAP device info */
export interface TapInfo {
  name: string;
  guestIp: string;
  gateway: string;
  macAddress: string;
  bridgeName: string;
}

/** Helper status */
export interface HelperStatus {
  installed: boolean;
  hasCapability: boolean;
  bridgeExists: boolean;
  bridgeName: string;
  message: string;
}

// Default configuration
const DEFAULT_BRIDGE_NAME = 'handler-br0';
const DEFAULT_GATEWAY = '192.168.127.1';
const DEFAULT_SUBNET_PREFIX = '192.168.127';
const HELPER_BINARY = 'handler-tap-helper';

// Search paths for the helper binary
const HELPER_PATHS = [
  '/usr/local/bin/handler-tap-helper',
  '/usr/local/lib/handler/handler-tap-helper',
  path.join(__dirname, '../../../../helpers/tap-helper/target/release/handler-tap-helper'),
];

export class TapHelper {
  private helperPath: string | null = null;
  private bridgeName: string;
  private gateway: string;
  private subnetPrefix: string;
  private usedIpSuffixes: Set<number> = new Set(); // Track all used IPs
  private allocatedTaps: Map<string, TapInfo> = new Map(); // vmId -> TapInfo

  constructor(options?: {
    bridgeName?: string;
    gateway?: string;
    subnetPrefix?: string;
  }) {
    this.bridgeName = options?.bridgeName || DEFAULT_BRIDGE_NAME;

    // Auto-detect gateway and subnet from the bridge's actual IP if not explicitly set
    const detected = options?.gateway ? null : this.detectBridgeIp();
    this.gateway = options?.gateway || detected?.gateway || DEFAULT_GATEWAY;
    this.subnetPrefix = options?.subnetPrefix || detected?.subnetPrefix || DEFAULT_SUBNET_PREFIX;
    this.helperPath = this.findHelper();

    if (detected) {
      console.log(`[TapHelper] Auto-detected bridge ${this.bridgeName} subnet: ${this.subnetPrefix}.0/24 (gateway: ${this.gateway})`);
    }
  }

  /**
   * Detect the bridge's IP address from the system to avoid hardcoded subnet mismatches
   */
  private detectBridgeIp(): { gateway: string; subnetPrefix: string } | null {
    try {
      const output = execFileSync('ip', ['-4', 'addr', 'show', this.bridgeName], {
        timeout: 3000,
        encoding: 'utf-8',
      });
      const match = output.match(/inet (\d+\.\d+\.\d+\.\d+)/);
      if (match) {
        const ip = match[1];
        const parts = ip.split('.');
        return {
          gateway: ip,
          subnetPrefix: `${parts[0]}.${parts[1]}.${parts[2]}`,
        };
      }
    } catch {
      // Bridge may not exist yet
    }
    return null;
  }

  /**
   * Find the helper binary in known locations
   */
  private findHelper(): string | null {
    for (const helperPath of HELPER_PATHS) {
      if (fs.existsSync(helperPath)) {
        return helperPath;
      }
    }
    return null;
  }

  /**
   * Check if a network device exists
   */
  private deviceExists(name: string): boolean {
    return fs.existsSync(`/sys/class/net/${name}`);
  }

  /**
   * Generate a MAC address for a TAP device
   */
  private generateMacAddress(suffix: number): string {
    // Use locally administered address (bit 1 of first octet set)
    // Format: 52:54:00:01:XX:XX where XX:XX is based on suffix
    const b1 = (suffix >> 8) & 0xff;
    const b2 = suffix & 0xff;
    return `52:54:00:01:${b1.toString(16).padStart(2, '0')}:${b2.toString(16).padStart(2, '0')}`;
  }

  /**
   * Scan the bridge ARP table for IPs already in use on the subnet.
   * This catches VMs from other Handler instances sharing the same bridge.
   */
  scanBridgeForUsedIps(): void {
    try {
      const output = execFileSync('ip', ['neigh', 'show', 'dev', this.bridgeName], {
        timeout: 3000,
        encoding: 'utf-8',
      });
      for (const line of output.split('\n')) {
        const match = line.match(/^(\d+\.\d+\.\d+\.\d+)\s/);
        if (match && match[1].startsWith(this.subnetPrefix + '.')) {
          const suffix = parseInt(match[1].split('.')[3], 10);
          if (suffix >= 2 && suffix <= 254 && !this.usedIpSuffixes.has(suffix)) {
            this.usedIpSuffixes.add(suffix);
            console.log(`[TapHelper] Found existing IP ${match[1]} on bridge ${this.bridgeName}`);
          }
        }
      }
    } catch {
      // Non-fatal — bridge may not exist yet or ip command may fail
    }
  }

  /**
   * Get the next available IP address
   */
  private getNextIp(): { ip: string; suffix: number } {
    // Find the first available suffix starting from 2
    for (let suffix = 2; suffix <= 254; suffix++) {
      if (!this.usedIpSuffixes.has(suffix)) {
        this.usedIpSuffixes.add(suffix);
        return { ip: `${this.subnetPrefix}.${suffix}`, suffix };
      }
    }
    throw new Error('No available IP addresses in subnet');
  }

  /**
   * Register an existing VM's IP as used (for restored VMs)
   */
  registerExistingIp(vmId: string, guestIp: string, tapInfo?: Partial<TapInfo>): void {
    const parts = guestIp.split('.');
    if (parts.length === 4) {
      const suffix = parseInt(parts[3], 10);
      if (suffix >= 2 && suffix <= 254) {
        this.usedIpSuffixes.add(suffix);
        console.log(`[TapHelper] Registered existing IP ${guestIp} (suffix ${suffix}) for VM ${vmId}`);

        // Also track in allocatedTaps if we have the info
        if (tapInfo) {
          this.allocatedTaps.set(vmId, {
            name: tapInfo.name || `tap-${vmId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`,
            guestIp,
            gateway: tapInfo.gateway || this.gateway,
            macAddress: tapInfo.macAddress || this.generateMacAddress(suffix),
            bridgeName: tapInfo.bridgeName || this.bridgeName,
          });
        }
      }
    }
  }

  /**
   * Release an IP address
   */
  private releaseIp(guestIp: string): void {
    const parts = guestIp.split('.');
    if (parts.length === 4) {
      const suffix = parseInt(parts[3], 10);
      this.usedIpSuffixes.delete(suffix);
      console.log(`[TapHelper] Released IP ${guestIp} (suffix ${suffix})`);
    }
  }

  /**
   * Run the helper with given arguments
   */
  private async runHelper(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.helperPath) {
      throw new Error('TAP helper not installed. Run: sudo ./scripts/user/install-tap-helper.sh');
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(this.helperPath!, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code || 0,
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Check if the helper is properly installed with capabilities
   */
  async checkStatus(): Promise<HelperStatus> {
    if (!this.helperPath) {
      return {
        installed: false,
        hasCapability: false,
        bridgeExists: false,
        bridgeName: this.bridgeName,
        message: 'TAP helper not found. Run: sudo ./scripts/user/install-tap-helper.sh',
      };
    }

    try {
      const result = await this.runHelper(['check-caps']);
      const hasCapability = result.exitCode === 0;
      const bridgeExists = this.deviceExists(this.bridgeName);

      let message = '';
      if (!hasCapability) {
        message = 'TAP helper missing CAP_NET_ADMIN. Run: sudo ./scripts/user/install-tap-helper.sh';
      } else if (!bridgeExists) {
        message = `Bridge ${this.bridgeName} not found. Run: sudo ./scripts/user/install-tap-helper.sh --setup-bridge`;
      } else {
        message = 'TAP helper ready for on-demand TAP creation';
      }

      return {
        installed: true,
        hasCapability,
        bridgeExists,
        bridgeName: this.bridgeName,
        message,
      };
    } catch (error) {
      return {
        installed: true,
        hasCapability: false,
        bridgeExists: false,
        bridgeName: this.bridgeName,
        message: `Failed to check helper status: ${error}`,
      };
    }
  }

  /**
   * Check if the helper is ready to create TAP devices
   */
  async isReady(): Promise<boolean> {
    const status = await this.checkStatus();
    return status.installed && status.hasCapability && status.bridgeExists;
  }

  /**
   * Create a TAP device for a VM
   * Note: Assumes checkStatus() has been called during initialization
   */
  async createTap(vmId: string): Promise<TapInfo> {
    // Skip status check for performance - it's checked during initialize()
    // Only verify the helper path exists
    if (!this.helperPath) {
      throw new Error('TAP helper not installed. Run: sudo ./scripts/user/install-tap-helper.sh');
    }

    // Generate TAP name based on VM ID (sanitized)
    const sanitizedId = vmId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
    const tapName = `tap-${sanitizedId}`;

    // Check if already allocated
    if (this.allocatedTaps.has(vmId)) {
      return this.allocatedTaps.get(vmId)!;
    }

    // Check if TAP already exists (from previous run or incomplete cleanup)
    if (this.deviceExists(tapName)) {
      console.log(`[TapHelper] TAP ${tapName} already exists, deleting first`);
      await this.deleteTap(vmId);
      // Wait for device to fully disappear before attempting re-creation
      const removed = await this.waitForDeviceRemoval(tapName);
      if (!removed) {
        console.warn(`[TapHelper] TAP ${tapName} still exists after cleanup, will retry creation`);
      }
    }

    const { ip: guestIp, suffix } = this.getNextIp();
    // MAC address is generated based on IP suffix
    const macAddress = this.generateMacAddress(suffix);

    // Get owner UID/GID (current user)
    const uid = process.getuid?.() || 1000;
    const gid = process.getgid?.() || 1000;

    console.log(`[TapHelper] Creating TAP ${tapName} for VM ${vmId}`);

    // Retry creation with backoff — the kernel may still be cleaning up the old device
    const maxRetries = 4;
    let lastError = '';
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = 1000 * attempt;
        console.log(`[TapHelper] Retrying TAP creation (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));

        // If the device reappeared or never left, try deleting again
        if (this.deviceExists(tapName)) {
          console.log(`[TapHelper] TAP ${tapName} still exists before retry, deleting`);
          try {
            await this.runHelper(['delete', '--name', tapName]);
            await this.waitForDeviceRemoval(tapName);
          } catch {}
          // Last resort: use ip link delete if helper couldn't remove it
          if (this.deviceExists(tapName)) {
            console.warn(`[TapHelper] Helper delete failed, trying ip link delete for ${tapName}`);
            try {
              execFileSync('ip', ['link', 'delete', tapName], { timeout: 5000 });
              await this.waitForDeviceRemoval(tapName);
            } catch {}
          }
        }
      }

      const result = await this.runHelper([
        'create',
        '--name', tapName,
        '--bridge', this.bridgeName,
        '--owner-uid', uid.toString(),
        '--owner-gid', gid.toString(),
        '--format', 'json',
      ]);

      if (result.exitCode === 0) {
        const tapInfo: TapInfo = {
          name: tapName,
          guestIp,
          gateway: this.gateway,
          macAddress,
          bridgeName: this.bridgeName,
        };

        this.allocatedTaps.set(vmId, tapInfo);
        console.log(`[TapHelper] Created TAP ${tapName} with IP ${guestIp}`);

        return tapInfo;
      }

      lastError = result.stderr || 'Unknown error';
      try {
        const json = JSON.parse(result.stdout);
        if (json.error) lastError = json.error;
      } catch {}
      console.warn(`[TapHelper] TAP creation attempt ${attempt + 1} failed: ${lastError}`);
    }

    // All retries exhausted — release the IP we reserved
    this.releaseIp(guestIp);
    throw new Error(`Failed to create TAP after ${maxRetries} attempts: ${lastError}`);
  }

  /**
   * Wait for a TAP device to disappear from the system after deletion.
   * The kernel may take a moment to fully clean up the device.
   */
  private async waitForDeviceRemoval(tapName: string, timeoutMs: number = 5000): Promise<boolean> {
    const interval = 100;
    const maxAttempts = Math.ceil(timeoutMs / interval);
    for (let i = 0; i < maxAttempts; i++) {
      if (!this.deviceExists(tapName)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    return !this.deviceExists(tapName);
  }

  /**
   * Delete a TAP device for a VM
   */
  async deleteTap(vmId: string): Promise<void> {
    const tapInfo = this.allocatedTaps.get(vmId);
    if (!tapInfo) {
      // Try to find by pattern
      const sanitizedId = vmId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
      const tapName = `tap-${sanitizedId}`;

      if (this.deviceExists(tapName)) {
        console.log(`[TapHelper] Deleting orphan TAP ${tapName}`);
        try {
          await this.runHelper(['delete', '--name', tapName]);
          await this.waitForDeviceRemoval(tapName);
        } catch (error) {
          console.warn(`[TapHelper] Failed to delete orphan TAP: ${error}`);
        }
      }
      return;
    }

    console.log(`[TapHelper] Deleting TAP ${tapInfo.name} for VM ${vmId}`);

    try {
      const result = await this.runHelper(['delete', '--name', tapInfo.name]);
      if (result.exitCode !== 0) {
        console.warn(`[TapHelper] Failed to delete TAP: ${result.stderr}`);
      }
      // Wait for the kernel to fully remove the device
      const removed = await this.waitForDeviceRemoval(tapInfo.name);
      if (!removed) {
        console.warn(`[TapHelper] TAP ${tapInfo.name} still exists after deletion, may cause issues on re-creation`);
      }
    } catch (error) {
      console.warn(`[TapHelper] Error deleting TAP: ${error}`);
    }

    // Release the IP for reuse
    this.releaseIp(tapInfo.guestIp);
    this.allocatedTaps.delete(vmId);
  }

  /**
   * Get TAP info for a VM
   */
  getTapInfo(vmId: string): TapInfo | null {
    return this.allocatedTaps.get(vmId) || null;
  }

  /**
   * Get all allocated TAPs
   */
  getAllocatedTaps(): Map<string, TapInfo> {
    return new Map(this.allocatedTaps);
  }

  /**
   * Clean up all TAP devices created by this helper
   */
  async cleanupAll(): Promise<void> {
    console.log(`[TapHelper] Cleaning up ${this.allocatedTaps.size} TAP devices`);

    for (const [vmId, tapInfo] of this.allocatedTaps) {
      try {
        await this.runHelper(['delete', '--name', tapInfo.name]);
        console.log(`[TapHelper] Deleted TAP ${tapInfo.name}`);
      } catch (error) {
        console.warn(`[TapHelper] Failed to delete TAP ${tapInfo.name}: ${error}`);
      }
    }

    this.allocatedTaps.clear();
  }
}

// Export singleton for convenience
let defaultHelper: TapHelper | null = null;

export function getTapHelper(): TapHelper {
  if (!defaultHelper) {
    defaultHelper = new TapHelper();
  }
  return defaultHelper;
}
