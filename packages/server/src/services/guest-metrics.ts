/**
 * Guest metrics collection for sandboxes.
 * Collects CPU, memory, and disk usage from inside Docker containers and VMs.
 * Results are cached in memory with a 2-second TTL.
 */

import Docker from 'dockerode';
import { spawnSync } from 'child_process';
import { execInContainer } from './docker.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface GuestMetrics {
  cpuUsage: number;      // 0-100
  memoryUsed: number;    // bytes
  memoryTotal: number;   // bytes
  memoryUsage: number;   // 0-100
  diskUsed: number;      // bytes
  diskTotal: number;     // bytes
  diskUsage: number;     // 0-100
}

// In-memory cache
const cache = new Map<string, { metrics: GuestMetrics; timestamp: number }>();
const CACHE_TTL = 2_000;

const docker = new Docker();

const SSH_OPTS = [
  '-o', 'StrictHostKeyChecking=no',
  '-o', 'UserKnownHostsFile=/dev/null',
  '-o', 'IdentitiesOnly=yes',
  '-o', 'ConnectTimeout=3',
  // Reuse a single TCP connection for repeated metrics polls (avoids full SSH handshake every 5s).
  // ControlPersist keeps the master connection alive for 60s after the last use.
  '-o', 'ControlMaster=auto',
  '-o', 'ControlPath=/tmp/handler-metrics-%r@%h:%p',
  '-o', 'ControlPersist=60',
];

// Batched command: read /proc/stat twice with 100ms delay for CPU delta, then meminfo and disk.
// Ends with 'kill 0' to terminate any background processes started by .bashrc (e.g. the Handler
// status watcher) that would otherwise keep the SSH session open via inherited FDs.
// We use spawnSync (not execFileSync) since kill 0 causes a non-zero exit code.
const METRICS_SCRIPT = 'cat /proc/stat; sleep 0.1; cat /proc/stat; echo "---MEMINFO---"; cat /proc/meminfo; echo "---DISK---"; df -B1 /; kill 0 2>/dev/null';

/** Strip ANSI/OSC escape sequences (e.g. OSC 7337 from shell init) */
function stripEscapeSequences(s: string): string {
  // OSC sequences: ESC ] ... BEL/ST, plus CSI sequences: ESC [ ... final byte
  return s.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

function parseCpuLine(line: string): number[] {
  // cpu  user nice system idle iowait irq softirq steal
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  return parts;
}

function computeCpuUsage(first: string, second: string): number {
  const firstLines = first.split('\n');
  const secondLines = second.split('\n');

  const firstCpu = firstLines.find(l => l.startsWith('cpu '));
  const secondCpu = secondLines.find(l => l.startsWith('cpu '));

  if (!firstCpu || !secondCpu) return 0;

  const a = parseCpuLine(firstCpu);
  const b = parseCpuLine(secondCpu);

  const aTotal = a.reduce((s, v) => s + v, 0);
  const bTotal = b.reduce((s, v) => s + v, 0);

  const totalDelta = bTotal - aTotal;
  // idle is index 3
  const idleDelta = (b[3] || 0) - (a[3] || 0);

  if (totalDelta <= 0) return 0;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
}

function parseMeminfo(section: string): { used: number; total: number } {
  const lines = section.split('\n');
  const values: Record<string, number> = {};

  for (const line of lines) {
    const match = line.match(/^(\w+):\s+(\d+)/);
    if (match) {
      values[match[1]] = parseInt(match[2], 10) * 1024; // kB to bytes
    }
  }

  const total = values['MemTotal'] || 0;
  const free = values['MemFree'] || 0;
  const buffers = values['Buffers'] || 0;
  const cached = values['Cached'] || 0;
  const sreclaimable = values['SReclaimable'] || 0;
  const used = total - free - buffers - cached - sreclaimable;

  return { used: Math.max(0, used), total };
}

function parseDf(section: string): { used: number; total: number } {
  const lines = section.trim().split('\n');
  // Skip header line, parse the data line
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    // Filesystem 1B-blocks Used Available Use% Mounted-on
    if (parts.length >= 4) {
      const total = parseInt(parts[1], 10);
      const used = parseInt(parts[2], 10);
      if (!isNaN(total) && !isNaN(used)) {
        return { used, total };
      }
    }
  }
  return { used: 0, total: 0 };
}

function parseMetricsOutput(output: string): GuestMetrics {
  // Split into sections: two /proc/stat readings, meminfo, df
  const meminfoIdx = output.indexOf('---MEMINFO---');
  const diskIdx = output.indexOf('---DISK---');

  if (meminfoIdx === -1 || diskIdx === -1) {
    throw new Error('Unexpected metrics output format');
  }

  const statSection = output.substring(0, meminfoIdx);
  const meminfoSection = output.substring(meminfoIdx + 13, diskIdx);
  const diskSection = output.substring(diskIdx + 10);

  // Split the two /proc/stat readings — find the second "cpu " occurrence
  const secondCpuIdx = statSection.indexOf('cpu ', statSection.indexOf('cpu ') + 1);
  if (secondCpuIdx === -1) {
    throw new Error('Could not find second /proc/stat reading');
  }

  // Find the start of the second stat block (it starts at a newline before the second "cpu ")
  const secondStart = statSection.lastIndexOf('\n', secondCpuIdx);
  const firstStat = statSection.substring(0, secondStart);
  const secondStat = statSection.substring(secondStart);

  const cpuUsage = computeCpuUsage(firstStat, secondStat);
  const mem = parseMeminfo(meminfoSection);
  const disk = parseDf(diskSection);

  return {
    cpuUsage,
    memoryUsed: mem.used,
    memoryTotal: mem.total,
    memoryUsage: mem.total > 0 ? Math.round((mem.used / mem.total) * 100) : 0,
    diskUsed: disk.used,
    diskTotal: disk.total,
    diskUsage: disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : 0,
  };
}

function getCached(sandboxId: string): GuestMetrics | null {
  const cached = cache.get(sandboxId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.metrics;
  }
  return null;
}

export async function getDockerMetrics(containerId: string, sandboxId: string): Promise<GuestMetrics> {
  const cached = getCached(sandboxId);
  if (cached) return cached;

  try {
    // Get CPU and memory from dockerode stats API
    const container = docker.getContainer(containerId);
    const [stats, diskOutput] = await Promise.all([
      Promise.race([
        container.stats({ stream: false }) as Promise<any>,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]),
      Promise.race([
        execInContainer(containerId, ['df', '-B1', '/']),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
      ]),
    ]);

    // CPU calculation from docker stats
    const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
    const numCpus = stats.cpu_stats.online_cpus || stats.cpu_stats.cpu_usage.percpu_usage?.length || 1;
    const cpuUsage = systemDelta > 0 ? Math.round((cpuDelta / systemDelta) * numCpus * 100) : 0;

    // Memory from docker stats
    const memoryUsed = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
    const memoryTotal = stats.memory_stats.limit;

    // Disk from df
    const disk = parseDf(diskOutput);

    const metrics: GuestMetrics = {
      cpuUsage: Math.min(100, Math.max(0, cpuUsage)),
      memoryUsed,
      memoryTotal,
      memoryUsage: memoryTotal > 0 ? Math.round((memoryUsed / memoryTotal) * 100) : 0,
      diskUsed: disk.used,
      diskTotal: disk.total,
      diskUsage: disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : 0,
    };

    cache.set(sandboxId, { metrics, timestamp: Date.now() });
    return metrics;
  } catch {
    throw new Error('Failed to collect Docker metrics');
  }
}

export async function getVmMetricsViaSsh(
  host: string,
  port: number,
  user: string,
  keyPath: string,
  sandboxId: string,
): Promise<GuestMetrics> {
  const cached = getCached(sandboxId);
  if (cached) return cached;

  try {
    const portArgs = port !== 22 ? ['-p', String(port)] : [];
    const result = spawnSync('ssh', [
      '-i', keyPath,
      ...portArgs,
      ...SSH_OPTS,
      `${user}@${host}`,
      METRICS_SCRIPT,
    ], { encoding: 'utf-8', timeout: 5000 });

    const raw = result.stdout || '';
    if (!raw.includes('---MEMINFO---')) {
      throw new Error(result.stderr || 'No metrics output');
    }

    const output = stripEscapeSequences(raw);
    const metrics = parseMetricsOutput(output);
    cache.set(sandboxId, { metrics, timestamp: Date.now() });
    return metrics;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to collect VM metrics via SSH: ${detail}`);
  }
}

export async function getCloudMetricsViaSsh(
  host: string,
  port: number,
  user: string,
  keyContent: string,
  sandboxId: string,
): Promise<GuestMetrics> {
  const cached = getCached(sandboxId);
  if (cached) return cached;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrics-key-'));
  const tempKeyPath = path.join(tempDir, 'key');
  fs.writeFileSync(tempKeyPath, keyContent, { mode: 0o600 });

  try {
    const portArgs = port !== 22 ? ['-p', String(port)] : [];
    const result = spawnSync('ssh', [
      '-i', tempKeyPath,
      ...portArgs,
      ...SSH_OPTS,
      `${user}@${host}`,
      METRICS_SCRIPT,
    ], { encoding: 'utf-8', timeout: 5000 });

    const raw = result.stdout || '';
    if (!raw.includes('---MEMINFO---')) {
      throw new Error(result.stderr || 'No metrics output');
    }

    const output = stripEscapeSequences(raw);
    const metrics = parseMetricsOutput(output);
    cache.set(sandboxId, { metrics, timestamp: Date.now() });
    return metrics;
  } catch {
    throw new Error('Failed to collect cloud VM metrics via SSH');
  } finally {
    fs.rmSync(tempDir, { recursive: true });
  }
}
