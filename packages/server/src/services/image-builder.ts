/**
 * Image Builder Service
 *
 * Manages VM image building operations: listing images with details,
 * inspecting images, and running build scripts (prepare, kernel build,
 * upload, download) with real-time output streaming.
 *
 * Dev-only: gated by environment=development at the route level.
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, PROJECT_ROOT } from '../lib/paths.js';

const BASE_IMAGES_DIR = path.join(DATA_DIR, 'base-images');

export interface ImageDetail {
  name: string;
  hasQcow2: boolean;
  hasRootfs: boolean;
  hasKernel: boolean;
  qcow2SizeBytes: number | null;
  rootfsSizeBytes: number | null;
  kernelSizeBytes: number | null;
  modifiedAt: string | null;
  isLayer: boolean;
  hasLayer: boolean;
  layerSizeBytes: number | null;
  parentImage: string | null;
  isMounted: boolean;
  mountCommand: string | null;
  umountCommand: string | null;
}

/**
 * Check if a path is currently a mount point by reading /proc/mounts.
 */
function isMounted(mountPoint: string): boolean {
  try {
    const mounts = fs.readFileSync('/proc/mounts', 'utf-8');
    return mounts.split('\n').some(line => line.split(' ')[1] === mountPoint);
  } catch {
    return false;
  }
}

export interface ImageInspection extends ImageDetail {
  filesystemInfo?: string;
}

export type OperationType = 'prepare' | 'kernel-build' | 'upload' | 'download';

export interface OperationState {
  id: string;
  type: OperationType;
  imageName?: string;
  startedAt: string;
  process: ChildProcess;
}

const activeOperations = new Map<string, OperationState>();

function getFileSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function getModifiedTime(dirPath: string): string | null {
  try {
    return fs.statSync(dirPath).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * List all base images with file presence and size details.
 */
export function listImageDetails(): ImageDetail[] {
  if (!fs.existsSync(BASE_IMAGES_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(BASE_IMAGES_DIR, { withFileTypes: true });
  const images: ImageDetail[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dir = path.join(BASE_IMAGES_DIR, entry.name);
    const qcow2Path = path.join(dir, 'image.qcow2');
    const rootfsPath = path.join(dir, 'rootfs.ext4');
    const kernelPath = path.join(dir, 'vmlinux');
    const layerJsonPath = path.join(dir, 'layer.json');
    const layerPath = path.join(dir, 'layer.ext4');

    // Parse layer.json if it exists
    let isLayer = false;
    let parentImage: string | null = null;
    if (fs.existsSync(layerJsonPath)) {
      isLayer = true;
      try {
        const layerJson = JSON.parse(fs.readFileSync(layerJsonPath, 'utf-8'));
        parentImage = layerJson.parent || null;
      } catch { /* ignore parse errors */ }
    }

    const hasRootfs = fs.existsSync(rootfsPath);
    const hasLayer = fs.existsSync(layerPath);
    const mountPoint = `/tmp/handler-image-${entry.name}`;
    const mounted = isMounted(mountPoint);
    const mountTarget = hasRootfs ? rootfsPath : hasLayer ? layerPath : null;

    images.push({
      name: entry.name,
      hasQcow2: fs.existsSync(qcow2Path),
      hasRootfs,
      hasKernel: fs.existsSync(kernelPath),
      qcow2SizeBytes: getFileSize(qcow2Path),
      rootfsSizeBytes: getFileSize(rootfsPath),
      kernelSizeBytes: getFileSize(kernelPath),
      modifiedAt: getModifiedTime(dir),
      isLayer,
      hasLayer,
      layerSizeBytes: getFileSize(layerPath),
      parentImage,
      isMounted: mounted,
      mountCommand: mountTarget ? `sudo mount -o loop ${mountTarget} ${mountPoint}` : null,
      umountCommand: mountTarget ? `sudo umount ${mountPoint}` : null,
    });
  }

  return images;
}

/**
 * Inspect a single image in more detail.
 * If rootfs.ext4 exists, runs dumpe2fs to get filesystem info.
 */
export async function inspectImage(name: string): Promise<ImageInspection> {
  const dir = path.join(BASE_IMAGES_DIR, name);
  if (!fs.existsSync(dir)) {
    throw new Error(`Image '${name}' not found`);
  }

  const qcow2Path = path.join(dir, 'image.qcow2');
  const rootfsPath = path.join(dir, 'rootfs.ext4');
  const kernelPath = path.join(dir, 'vmlinux');
  const layerJsonPath = path.join(dir, 'layer.json');
  const layerPath = path.join(dir, 'layer.ext4');

  // Parse layer.json if it exists
  let isLayer = false;
  let parentImage: string | null = null;
  if (fs.existsSync(layerJsonPath)) {
    isLayer = true;
    try {
      const layerJson = JSON.parse(fs.readFileSync(layerJsonPath, 'utf-8'));
      parentImage = layerJson.parent || null;
    } catch { /* ignore parse errors */ }
  }

  const hasRootfs = fs.existsSync(rootfsPath);
  const hasLayer = fs.existsSync(layerPath);
  const mountPoint = `/tmp/handler-image-${name}`;
  const mounted = isMounted(mountPoint);
  const mountTarget = hasRootfs ? rootfsPath : hasLayer ? layerPath : null;

  const detail: ImageInspection = {
    name,
    hasQcow2: fs.existsSync(qcow2Path),
    hasRootfs,
    hasKernel: fs.existsSync(kernelPath),
    qcow2SizeBytes: getFileSize(qcow2Path),
    rootfsSizeBytes: getFileSize(rootfsPath),
    kernelSizeBytes: getFileSize(kernelPath),
    modifiedAt: getModifiedTime(dir),
    isLayer,
    hasLayer,
    layerSizeBytes: getFileSize(layerPath),
    parentImage,
    isMounted: mounted,
    mountCommand: mountTarget ? `sudo mount -o loop ${mountTarget} ${mountPoint}` : null,
    umountCommand: mountTarget ? `sudo umount ${mountPoint}` : null,
  };

  // Try to get filesystem info from rootfs or layer
  const ext4Target = detail.hasRootfs ? rootfsPath : detail.hasLayer ? layerPath : null;
  if (ext4Target) {
    try {
      const { execFileSync } = await import('child_process');
      const output = execFileSync('dumpe2fs', ['-h', ext4Target], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      // Extract key fields
      const lines = output.split('\n');
      const keyFields = ['Block count', 'Block size', 'Free blocks', 'Filesystem created', 'Last mount time'];
      const filtered = lines.filter(line =>
        keyFields.some(f => line.startsWith(f))
      );
      detail.filesystemInfo = filtered.join('\n');
    } catch {
      // dumpe2fs may not be installed or may require root
    }
  }

  return detail;
}

/**
 * Run a build operation (shell script) and stream output line-by-line.
 * Returns the operation ID for cancel support.
 */
export function runOperation(
  type: OperationType,
  args: { imageName?: string; kernelVersion?: string; uploadConfig?: { awsProfile?: string; s3Bucket?: string; s3Region?: string } },
  onOutput: (line: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
): string {
  const id = `${type}-${Date.now()}`;
  let scriptPath: string;
  let scriptArgs: string[] = [];

  switch (type) {
    case 'prepare':
      if (!args.imageName) throw new Error('imageName required for prepare');
      scriptPath = path.join(PROJECT_ROOT, 'scripts', 'dev', 'prepare-fc-image.sh');
      scriptArgs = ['--non-interactive', args.imageName];
      break;
    case 'kernel-build':
      scriptPath = path.join(PROJECT_ROOT, 'scripts', 'dev', 'build-fc-kernel.sh');
      if (args.kernelVersion) {
        scriptArgs = [args.kernelVersion];
      }
      break;
    case 'upload':
      if (!args.imageName) throw new Error('imageName required for upload');
      scriptPath = path.join(PROJECT_ROOT, 'scripts', 'dev', 'upload-fc-image.sh');
      scriptArgs = [args.imageName];
      break;
    case 'download':
      if (!args.imageName) throw new Error('imageName required for download');
      scriptPath = path.join(PROJECT_ROOT, 'scripts', 'user', 'download-image.sh');
      scriptArgs = ['--image', args.imageName];
      break;
    default:
      throw new Error(`Unknown operation type: ${type}`);
  }

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  // Build env with optional upload config overrides
  const env: Record<string, string | undefined> = { ...process.env, BASE_IMAGES_DIR };
  if (type === 'upload' && args.uploadConfig) {
    if (args.uploadConfig.awsProfile) env.AWS_PROFILE = args.uploadConfig.awsProfile;
    if (args.uploadConfig.s3Bucket) env.S3_BUCKET = args.uploadConfig.s3Bucket;
    if (args.uploadConfig.s3Region) env.S3_REGION = args.uploadConfig.s3Region;
  }

  const child = spawn('bash', [scriptPath, ...scriptArgs], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const op: OperationState = {
    id,
    type,
    imageName: args.imageName,
    startedAt: new Date().toISOString(),
    process: child,
  };
  activeOperations.set(id, op);

  let stdoutBuffer = '';
  let stderrBuffer = '';

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      onOutput(line);
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop() || '';
    for (const line of lines) {
      onOutput(`[stderr] ${line}`);
    }
  });

  child.on('close', (code) => {
    activeOperations.delete(id);
    // Flush remaining buffers
    if (stdoutBuffer) onOutput(stdoutBuffer);
    if (stderrBuffer) onOutput(`[stderr] ${stderrBuffer}`);

    if (code === 0) {
      onDone();
    } else {
      onError(`Process exited with code ${code}`);
    }
  });

  child.on('error', (err) => {
    activeOperations.delete(id);
    onError(err.message);
  });

  return id;
}

/**
 * Delete an image directory entirely.
 * Refuses to delete if the image has an active operation or is mounted.
 */
export function deleteImage(name: string): void {
  const dir = path.join(BASE_IMAGES_DIR, name);
  if (!fs.existsSync(dir)) {
    throw new Error(`Image '${name}' not found`);
  }

  // Refuse if mounted
  const mountPoint = `/tmp/handler-image-${name}`;
  if (isMounted(mountPoint)) {
    throw new Error(`Image '${name}' is currently mounted at ${mountPoint}. Unmount first.`);
  }

  // Refuse if there's an active operation on this image
  for (const op of activeOperations.values()) {
    if (op.imageName === name) {
      throw new Error(`Image '${name}' has an active ${op.type} operation. Cancel it first.`);
    }
  }

  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Cancel a running operation by killing the spawned process.
 */
export function cancelOperation(id: string): boolean {
  const op = activeOperations.get(id);
  if (!op) return false;

  op.process.kill('SIGTERM');
  // Force kill after 3 seconds if it doesn't exit
  setTimeout(() => {
    if (activeOperations.has(id)) {
      op.process.kill('SIGKILL');
      activeOperations.delete(id);
    }
  }, 3000);

  return true;
}

/**
 * List active operations (without the process handle).
 */
export function listOperations(): Array<{ id: string; type: OperationType; imageName?: string; startedAt: string }> {
  return Array.from(activeOperations.values()).map(({ id, type, imageName, startedAt }) => ({
    id, type, imageName, startedAt,
  }));
}
