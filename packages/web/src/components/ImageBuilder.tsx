import { useState, useRef, useCallback, useEffect } from 'react';
import { HardDrive, Play, Terminal, Upload, Download, Loader2, X, Wrench, ChevronDown, ChevronRight, Layers, Copy, Check, PanelRight, PanelBottom, GripVertical, GripHorizontal, Info, Trash2, AlertTriangle } from 'lucide-react';
import { useBuilderImages } from '../hooks/useImageBuilder';
import { useQueryClient } from '@tanstack/react-query';
import * as api from '../api/client';
import type { ImageBuilderDetail } from '../api/client';
import { TerminalInstance } from './Terminal/TerminalInstance';

function formatSize(bytes: number | null): string {
  if (bytes === null) return '-';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleString();
}

const GUIDE_KEY = 'handler-image-builder-guide-open';

function ProcessGuide() {
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(GUIDE_KEY);
    return stored === null ? true : stored === 'true';
  });

  const toggle = useCallback(() => {
    setOpen(prev => {
      localStorage.setItem(GUIDE_KEY, String(!prev));
      return !prev;
    });
  }, []);

  return (
    <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[hsl(var(--bg-elevated)/0.5)] transition-colors"
      >
        <Info className="h-3.5 w-3.5 text-[hsl(var(--cyan))] flex-shrink-0" />
        <span className="text-xs font-medium text-[hsl(var(--text-secondary))]">
          How image building works
        </span>
        {open
          ? <ChevronDown className="h-3 w-3 text-[hsl(var(--text-muted))] ml-auto" />
          : <ChevronRight className="h-3 w-3 text-[hsl(var(--text-muted))] ml-auto" />}
      </button>

      {open && (
        <div className="px-4 pb-4 text-xs text-[hsl(var(--text-secondary))] leading-relaxed space-y-4">
          {/* Overview */}
          <p className="text-[hsl(var(--text-muted))]">
            Firecracker VMs boot from two files: a <strong className="text-[hsl(var(--text-secondary))]">rootfs.ext4</strong> (root filesystem)
            and a <strong className="text-[hsl(var(--text-secondary))]">vmlinux</strong> (uncompressed Linux kernel).
            This page manages the pipeline that creates, customizes, and distributes those files.
          </p>

          {/* Steps */}
          <div className="space-y-3">
            {/* Step 1 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] flex items-center justify-center text-[10px] font-bold mt-0.5">1</div>
              <div>
                <div className="font-medium text-[hsl(var(--text-primary))] mb-0.5">Download a base QCOW2 image</div>
                <p className="text-[hsl(var(--text-muted))]">
                  Start with a cloud image (e.g. Ubuntu 24.04 QCOW2 from Canonical). Place it
                  at <code className="text-[10px] px-1 py-0.5 bg-[hsl(var(--bg-base))]">data/base-images/{'<name>'}/image.qcow2</code>,
                  or use the <strong className="text-[hsl(var(--text-secondary))]">Download</strong> button to pull a pre-built image from S3.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] flex items-center justify-center text-[10px] font-bold mt-0.5">2</div>
              <div>
                <div className="font-medium text-[hsl(var(--text-primary))] mb-0.5">Prepare the image</div>
                <p className="text-[hsl(var(--text-muted))]">
                  The <strong className="text-[hsl(var(--text-secondary))]">Prepare</strong> button
                  runs <code className="text-[10px] px-1 py-0.5 bg-[hsl(var(--bg-base))]">prepare-fc-image.sh</code>, which:
                  converts QCOW2 to raw ext4 (<code className="text-[10px]">rootfs.ext4</code>),
                  extracts the kernel (<code className="text-[10px]">vmlinux</code>),
                  and installs guest-init scripts (MMDS networking, overlay-init, Docker CE, tmux).
                </p>
              </div>
            </div>

            {/* Step 3 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[hsl(var(--amber)/0.15)] text-[hsl(var(--amber))] flex items-center justify-center text-[10px] font-bold mt-0.5">3</div>
              <div>
                <div className="font-medium text-[hsl(var(--text-primary))] mb-0.5">Build a custom kernel (optional)</div>
                <p className="text-[hsl(var(--text-muted))]">
                  The <strong className="text-[hsl(var(--text-secondary))]">Build Kernel</strong> button
                  compiles a Linux kernel with Docker support (iptables, overlay2, namespaces, cgroups) all as built-ins,
                  since Firecracker boots with <code className="text-[10px]">nomodule</code>. Only needed once or when upgrading kernel versions.
                </p>
              </div>
            </div>

            {/* Step 4 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[hsl(var(--green)/0.15)] text-[hsl(var(--green))] flex items-center justify-center text-[10px] font-bold mt-0.5">4</div>
              <div>
                <div className="font-medium text-[hsl(var(--text-primary))] mb-0.5">Inspect and customize</div>
                <p className="text-[hsl(var(--text-muted))]">
                  Mount the image filesystem using the mount command on each card, then
                  use <strong className="text-[hsl(var(--text-secondary))]">Shell</strong> to chroot in and make changes
                  (install packages, edit configs). Unmount when done.
                </p>
              </div>
            </div>

            {/* Step 5 */}
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-5 h-5 rounded-full bg-[hsl(var(--amber)/0.15)] text-[hsl(var(--amber))] flex items-center justify-center text-[10px] font-bold mt-0.5">5</div>
              <div>
                <div className="font-medium text-[hsl(var(--text-primary))] mb-0.5">Upload to S3</div>
                <p className="text-[hsl(var(--text-muted))]">
                  The <strong className="text-[hsl(var(--text-secondary))]">Upload</strong> button compresses the rootfs, generates SHA256 checksums,
                  creates a manifest, and uploads everything to S3. Users then run <code className="text-[10px] px-1 py-0.5 bg-[hsl(var(--bg-base))]">download-image.sh</code> to pull it.
                </p>
              </div>
            </div>
          </div>

          {/* Layer images explanation */}
          <div className="border-t border-[hsl(var(--border))] pt-3">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Layers className="h-3 w-3 text-[hsl(var(--purple))]" />
              <span className="font-medium text-[hsl(var(--text-primary))]">Layer images</span>
            </div>
            <p className="text-[hsl(var(--text-muted))]">
              When you snapshot a running VM and promote it to a base image, it creates a <strong className="text-[hsl(var(--text-secondary))]">layer image</strong> instead
              of copying the full disk. A layer contains only the diff from its parent (<code className="text-[10px]">layer.ext4</code>)
              plus a <code className="text-[10px]">layer.json</code> pointing to the parent. At boot, Firecracker stacks the
              parent rootfs + layer via overlayfs. Layer images can be uploaded and downloaded just like base images,
              but they can't be Prepared (they don't come from a QCOW2).
            </p>
          </div>

          {/* File layout */}
          <div className="border-t border-[hsl(var(--border))] pt-3">
            <div className="font-medium text-[hsl(var(--text-primary))] mb-1.5">File layout</div>
            <div className="font-mono text-[10px] text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-base))] p-2.5 leading-relaxed">
              <div>data/base-images/</div>
              <div className="pl-4">ubuntu-24.04/           <span className="text-[hsl(var(--cyan))]"># base image</span></div>
              <div className="pl-8">image.qcow2           <span className="text-[hsl(var(--text-muted))]"># source cloud image</span></div>
              <div className="pl-8">rootfs.ext4            <span className="text-[hsl(var(--text-muted))]"># prepared root filesystem</span></div>
              <div className="pl-8">vmlinux                <span className="text-[hsl(var(--text-muted))]"># uncompressed kernel</span></div>
              <div className="pl-4">claude-base/            <span className="text-[hsl(var(--purple))]"># layer image</span></div>
              <div className="pl-8">layer.ext4             <span className="text-[hsl(var(--text-muted))]"># diff from parent</span></div>
              <div className="pl-8">layer.json             <span className="text-[hsl(var(--text-muted))]"># {"{"}"parent": "ubuntu-24.04"{"}"}</span></div>
              <div className="pl-8">vmlinux                <span className="text-[hsl(var(--text-muted))]"># kernel (shared or copied)</span></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type OperationStatus = 'idle' | 'running' | 'done' | 'error';

interface LogEntry {
  line: string;
  timestamp: number;
}

interface UploadConfig {
  awsProfile: string;
  s3Bucket: string;
  s3Region: string;
}

type ShellPosition = 'right' | 'bottom';
const SHELL_POSITION_KEY = 'handler-image-shell-position';

function getDefaultShellPosition(): ShellPosition {
  const stored = localStorage.getItem(SHELL_POSITION_KEY);
  if (stored === 'right' || stored === 'bottom') return stored;
  return window.innerWidth >= 1920 ? 'right' : 'bottom';
}

function UploadDialog({
  image,
  onConfirm,
  onCancel,
}: {
  image: ImageBuilderDetail;
  onConfirm: (config: UploadConfig) => void;
  onCancel: () => void;
}) {
  const [awsProfile, setAwsProfile] = useState('');
  const [s3Bucket, setS3Bucket] = useState('handler.dev-public');
  const [s3Region, setS3Region] = useState('us-east-2');
  const [profiles, setProfiles] = useState<string[]>([]);

  useEffect(() => {
    api.listAwsProfiles().then(res => setProfiles(res.profiles)).catch(() => {});
  }, []);

  const files = image.isLayer
    ? 'layer.ext4.gz + layer.json'
    : 'rootfs.ext4.gz + vmlinux';
  const dest = `s3://${s3Bucket}/images/${image.name}/firecracker/`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-4">
          <Upload className="h-4 w-4 text-[hsl(var(--amber))]" />
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
            Upload {image.name}
          </h3>
        </div>

        <div className="space-y-3">
          {/* AWS Profile */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))] mb-1">
              AWS Profile
            </label>
            <input
              type="text"
              list="aws-profiles-list"
              value={awsProfile}
              onChange={e => setAwsProfile(e.target.value)}
              placeholder="default"
              className="w-full px-2 py-1.5 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:border-[hsl(var(--cyan)/0.5)]"
            />
            <datalist id="aws-profiles-list">
              {profiles.map(p => <option key={p} value={p} />)}
            </datalist>
          </div>

          {/* S3 Bucket */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))] mb-1">
              S3 Bucket
            </label>
            <input
              type="text"
              value={s3Bucket}
              onChange={e => setS3Bucket(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none focus:border-[hsl(var(--cyan)/0.5)]"
            />
          </div>

          {/* S3 Region */}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))] mb-1">
              S3 Region
            </label>
            <input
              type="text"
              value={s3Region}
              onChange={e => setS3Region(e.target.value)}
              className="w-full px-2 py-1.5 text-xs bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] focus:outline-none focus:border-[hsl(var(--cyan)/0.5)]"
            />
          </div>

          {/* Files preview */}
          <div className="bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))] mb-1.5">Files</div>
            <div className="text-xs text-[hsl(var(--text-secondary))] font-mono">{files}</div>
            <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))] mt-2 mb-1.5">Destination</div>
            <div className="text-xs text-[hsl(var(--text-secondary))] font-mono break-all">{dest}</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[10px] font-medium text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ awsProfile, s3Bucket, s3Region })}
            className="px-3 py-1.5 text-[10px] font-medium text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] transition-colors"
          >
            Start Upload
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="flex-shrink-0 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
      title="Copy to clipboard"
    >
      {copied
        ? <Check className="h-3 w-3 text-[hsl(var(--green))]" />
        : <Copy className="h-3 w-3" />}
    </button>
  );
}

function DeleteConfirmDialog({
  imageName,
  isLayer,
  onConfirm,
  onCancel,
}: {
  imageName: string;
  isLayer: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--red)/0.3)] p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-[hsl(var(--red))]" />
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Delete {imageName}?</h3>
        </div>
        <p className="text-xs text-[hsl(var(--text-secondary))] mb-1">
          This will permanently delete the entire image directory including:
        </p>
        <ul className="text-xs text-[hsl(var(--text-muted))] mb-4 space-y-0.5 ml-4 list-disc">
          {isLayer ? (
            <>
              <li>layer.ext4 (filesystem diff)</li>
              <li>layer.json (parent reference)</li>
            </>
          ) : (
            <>
              <li>image.qcow2 (source image)</li>
              <li>rootfs.ext4 (root filesystem)</li>
            </>
          )}
          <li>vmlinux (kernel)</li>
          <li>Any compressed files (.gz) and manifests</li>
        </ul>
        <p className="text-[10px] text-[hsl(var(--red))] mb-4">
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[10px] font-medium text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-[10px] font-medium text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] transition-colors"
          >
            Delete Image
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageCard({
  image,
  onShell,
  onOperation,
  onUploadClick,
  onDeleteClick,
  activeOperation,
}: {
  image: ImageBuilderDetail;
  onShell: (name: string) => void;
  onOperation: (type: 'prepare' | 'download', name: string) => void;
  onUploadClick: (image: ImageBuilderDetail) => void;
  onDeleteClick: (image: ImageBuilderDetail) => void;
  activeOperation: string | null;
}) {
  const isBusy = activeOperation !== null;
  const hasFs = image.hasRootfs || image.hasLayer;
  const canShell = hasFs && image.isMounted;
  const canUpload = hasFs;

  return (
    <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-4 hover:border-[hsl(var(--cyan)/0.3)] transition-colors">
      {/* Header */}
      <div className="flex items-start gap-2 mb-3">
        <HardDrive className="h-4 w-4 text-[hsl(var(--purple))] flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] break-all leading-tight">
            {image.name}
          </h3>
          {image.isLayer && image.parentImage && (
            <div className="flex items-center gap-1 mt-1">
              <Layers className="h-3 w-3 text-[hsl(var(--purple))]" />
              <span className="text-[10px] text-[hsl(var(--purple))]">
                Layer of {image.parentImage}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* File presence badges */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
          image.hasQcow2
            ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))]'
            : 'bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))]'
        }`}>
          qcow2 {image.hasQcow2 && <span className="opacity-70">({formatSize(image.qcow2SizeBytes)})</span>}
        </span>
        <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
          image.hasRootfs
            ? 'bg-[hsl(var(--green)/0.15)] text-[hsl(var(--green))]'
            : 'bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))]'
        }`}>
          rootfs {image.hasRootfs && <span className="opacity-70">({formatSize(image.rootfsSizeBytes)})</span>}
        </span>
        <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
          image.hasLayer
            ? 'bg-[hsl(var(--purple)/0.15)] text-[hsl(var(--purple))]'
            : 'bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))]'
        }`}>
          layer {image.hasLayer && <span className="opacity-70">({formatSize(image.layerSizeBytes)})</span>}
        </span>
        <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
          image.hasKernel
            ? 'bg-[hsl(var(--amber)/0.15)] text-[hsl(var(--amber))]'
            : 'bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))]'
        }`}>
          kernel {image.hasKernel && <span className="opacity-70">({formatSize(image.kernelSizeBytes)})</span>}
        </span>
      </div>

      {/* Mount status + commands (shown when a mountable filesystem exists) */}
      {image.mountCommand && (
        <div className={`mb-3 bg-[hsl(var(--bg-base))] border p-2 space-y-1.5 ${
          image.isMounted
            ? 'border-[hsl(var(--green)/0.3)]'
            : 'border-[hsl(var(--border))]'
        }`}>
          {/* Status indicator */}
          <div className="flex items-center gap-1.5">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${
              image.isMounted ? 'bg-[hsl(var(--green))]' : 'bg-[hsl(var(--text-muted))]'
            }`} />
            <span className={`text-[10px] font-medium ${
              image.isMounted ? 'text-[hsl(var(--green))]' : 'text-[hsl(var(--text-muted))]'
            }`}>
              {image.isMounted ? 'Mounted' : 'Not mounted'}
            </span>
          </div>

          {/* Mount command */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[hsl(var(--text-muted))] w-12 flex-shrink-0">mount</span>
            <code className="flex-1 text-[10px] font-mono text-[hsl(var(--text-secondary))] break-all select-all leading-relaxed">
              {image.mountCommand}
            </code>
            <CopyButton text={image.mountCommand} />
          </div>

          {/* Umount command */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[hsl(var(--text-muted))] w-12 flex-shrink-0">umount</span>
            <code className="flex-1 text-[10px] font-mono text-[hsl(var(--text-secondary))] break-all select-all leading-relaxed">
              {image.umountCommand}
            </code>
            <CopyButton text={image.umountCommand!} />
          </div>
        </div>
      )}

      {/* Modified date */}
      <div className="text-[10px] text-[hsl(var(--text-muted))] mb-3">
        Modified: {formatDate(image.modifiedAt)}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onOperation('prepare', image.name)}
          disabled={isBusy || image.isLayer}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] transition-colors disabled:opacity-40"
          title={image.isLayer ? 'Layer images are created from VM snapshots' : 'Prepare image (convert qcow2 to rootfs, extract kernel)'}
        >
          {activeOperation === 'prepare' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
          Prepare
        </button>
        <button
          onClick={() => onShell(image.name)}
          disabled={!canShell || isBusy}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] transition-colors disabled:opacity-40"
          title={canShell ? (image.isLayer ? 'Open shell into layer (partial filesystem)' : 'Open shell into rootfs') : hasFs ? 'Mount the filesystem first (see command above)' : 'rootfs.ext4 or layer.ext4 required'}
        >
          <Terminal className="h-3 w-3" />
          Shell
        </button>
        <button
          onClick={() => onUploadClick(image)}
          disabled={!canUpload || isBusy}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] transition-colors disabled:opacity-40"
          title="Upload to S3"
        >
          {activeOperation === 'upload' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          Upload
        </button>
        <button
          onClick={() => onOperation('download', image.name)}
          disabled={isBusy}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.1)] border border-[hsl(var(--purple)/0.3)] transition-colors disabled:opacity-40"
          title="Download image from S3"
        >
          {activeOperation === 'download' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          Download
        </button>
        <button
          onClick={() => onDeleteClick(image)}
          disabled={isBusy || image.isMounted}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] transition-colors disabled:opacity-40 ml-auto"
          title={image.isMounted ? 'Unmount the filesystem first' : 'Delete image'}
        >
          <Trash2 className="h-3 w-3" />
          Delete
        </button>
      </div>
    </div>
  );
}

export function ImageBuilder() {
  const { data: images, isLoading } = useBuilderImages();
  const queryClient = useQueryClient();

  // Log panel state
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logStatus, setLogStatus] = useState<OperationStatus>('idle');
  const [logTitle, setLogTitle] = useState('');
  const [logPanelOpen, setLogPanelOpen] = useState(false);
  const [activeOperations, setActiveOperations] = useState<Record<string, string>>({});
  const cancelRef = useRef<(() => void) | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Shell state
  const [shellImage, setShellImage] = useState<string | null>(null);
  const [shellPosition, setShellPositionState] = useState<ShellPosition>(getDefaultShellPosition);
  const [shellSize, setShellSize] = useState(() => getDefaultShellPosition() === 'right' ? 700 : 350);
  const [isResizing, setIsResizing] = useState(false);

  // Kernel build state
  const [kernelBuildRunning, setKernelBuildRunning] = useState(false);

  // Upload dialog state
  const [uploadDialogImage, setUploadDialogImage] = useState<ImageBuilderDetail | null>(null);

  // Delete dialog state
  const [deleteDialogImage, setDeleteDialogImage] = useState<ImageBuilderDetail | null>(null);

  const setShellPosition = useCallback((pos: ShellPosition) => {
    setShellPositionState(pos);
    localStorage.setItem(SHELL_POSITION_KEY, pos);
    setShellSize(pos === 'right' ? 700 : 350);
  }, []);

  // Resize handler for shell panel
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (shellPosition === 'bottom') {
        const newSize = window.innerHeight - e.clientY;
        setShellSize(Math.max(200, Math.min(newSize, window.innerHeight - 100)));
      } else {
        const newSize = window.innerWidth - e.clientX;
        setShellSize(Math.max(300, Math.min(newSize, window.innerWidth - 300)));
      }
    };

    const handleMouseUp = () => setIsResizing(false);

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, shellPosition]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, []);

  const startOperation = useCallback((
    type: string,
    name: string,
    cancelFn: () => void,
  ) => {
    setLogs([]);
    setLogStatus('running');
    setLogTitle(`${type} — ${name}`);
    setLogPanelOpen(true);
    setActiveOperations(prev => ({ ...prev, [name]: type }));
    cancelRef.current = cancelFn;
  }, []);

  const onOperationDone = useCallback((name: string) => {
    setLogStatus('done');
    setActiveOperations(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    queryClient.invalidateQueries({ queryKey: ['builder-images'] });
  }, [queryClient]);

  const onOperationError = useCallback((name: string, error: string) => {
    setLogs(prev => [...prev, { line: `ERROR: ${error}`, timestamp: Date.now() }]);
    setLogStatus('error');
    setActiveOperations(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    scrollToBottom();
  }, [scrollToBottom]);

  const handleOperation = useCallback((type: 'prepare' | 'download', name: string) => {
    if (cancelRef.current) {
      cancelRef.current();
    }

    const operationFn = type === 'prepare' ? api.prepareImage : api.downloadBuilderImage;

    const cancel = operationFn(
      name,
      (line) => {
        setLogs(prev => [...prev, { line, timestamp: Date.now() }]);
        scrollToBottom();
      },
      () => onOperationDone(name),
      (error) => onOperationError(name, error),
    );

    startOperation(type, name, cancel);
  }, [scrollToBottom, startOperation, onOperationDone, onOperationError]);

  const handleUploadClick = useCallback((image: ImageBuilderDetail) => {
    setUploadDialogImage(image);
  }, []);

  const handleUploadConfirm = useCallback((config: UploadConfig) => {
    const image = uploadDialogImage;
    if (!image) return;
    setUploadDialogImage(null);

    if (cancelRef.current) {
      cancelRef.current();
    }

    const cancel = api.uploadImage(
      image.name,
      (line) => {
        setLogs(prev => [...prev, { line, timestamp: Date.now() }]);
        scrollToBottom();
      },
      () => onOperationDone(image.name),
      (error) => onOperationError(image.name, error),
      {
        awsProfile: config.awsProfile || undefined,
        s3Bucket: config.s3Bucket || undefined,
        s3Region: config.s3Region || undefined,
      },
    );

    startOperation('upload', image.name, cancel);
  }, [uploadDialogImage, scrollToBottom, startOperation, onOperationDone, onOperationError]);

  const handleKernelBuild = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
    }

    setLogs([]);
    setLogStatus('running');
    setLogTitle('kernel build');
    setLogPanelOpen(true);
    setKernelBuildRunning(true);

    const cancel = api.buildKernel(
      {},
      (line) => {
        setLogs(prev => [...prev, { line, timestamp: Date.now() }]);
        scrollToBottom();
      },
      () => {
        setLogStatus('done');
        setKernelBuildRunning(false);
        queryClient.invalidateQueries({ queryKey: ['builder-images'] });
      },
      (error) => {
        setLogs(prev => [...prev, { line: `ERROR: ${error}`, timestamp: Date.now() }]);
        setLogStatus('error');
        setKernelBuildRunning(false);
        scrollToBottom();
      },
    );

    cancelRef.current = cancel;
  }, [queryClient, scrollToBottom]);

  const handleCancelOperation = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }
    setLogStatus('idle');
    setActiveOperations({});
    setKernelBuildRunning(false);
  }, []);

  const handleShell = useCallback((name: string) => {
    setShellImage(name);
  }, []);

  const handleDeleteClick = useCallback((image: ImageBuilderDetail) => {
    setDeleteDialogImage(image);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteDialogImage) return;
    try {
      await api.deleteBuilderImage(deleteDialogImage.name);
      queryClient.invalidateQueries({ queryKey: ['builder-images'] });
      setDeleteDialogImage(null);
    } catch (error) {
      console.error('Failed to delete image:', error);
      alert(`Failed to delete: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [deleteDialogImage, queryClient]);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Upload dialog */}
      {uploadDialogImage && (
        <UploadDialog
          image={uploadDialogImage}
          onConfirm={handleUploadConfirm}
          onCancel={() => setUploadDialogImage(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteDialogImage && (
        <DeleteConfirmDialog
          imageName={deleteDialogImage.name}
          isLayer={deleteDialogImage.isLayer}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteDialogImage(null)}
        />
      )}

      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))]">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider bg-[hsl(var(--amber)/0.15)] text-[hsl(var(--amber))]">
            dev
          </span>
          <span className="text-xs text-[hsl(var(--text-secondary))]">
            {images?.length || 0} base image{images?.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleKernelBuild}
            disabled={kernelBuildRunning}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-medium text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] transition-colors disabled:opacity-40"
          >
            {kernelBuildRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Build Kernel
          </button>
        </div>
      </div>

      {/* Content area with split view */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Image grid */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <ProcessGuide />

          {!images || images.length === 0 ? (
            <div className="text-center py-12">
              <HardDrive className="h-8 w-8 text-[hsl(var(--text-muted))] mx-auto mb-3" />
              <p className="text-sm text-[hsl(var(--text-muted))]">No base images found</p>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                Base images should be in data/base-images/
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {images.map(image => (
                <ImageCard
                  key={image.name}
                  image={image}
                  onShell={handleShell}
                  onOperation={handleOperation}
                  onUploadClick={handleUploadClick}
                  onDeleteClick={handleDeleteClick}
                  activeOperation={activeOperations[image.name] || null}
                />
              ))}
            </div>
          )}
        </div>

        {/* Log panel */}
        {logPanelOpen && (
          <div className="border-t border-[hsl(var(--border))] flex flex-col" style={{ height: '240px' }}>
            <div className="flex items-center justify-between px-3 py-1.5 bg-[hsl(var(--bg-surface))] border-b border-[hsl(var(--border))]">
              <button
                onClick={() => setLogPanelOpen(!logPanelOpen)}
                className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-secondary))] uppercase tracking-wider"
              >
                {logPanelOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span>{logTitle}</span>
                <span className={`px-1 py-0.5 text-[9px] rounded ${
                  logStatus === 'running' ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))]' :
                  logStatus === 'done' ? 'bg-[hsl(var(--green)/0.15)] text-[hsl(var(--green))]' :
                  logStatus === 'error' ? 'bg-[hsl(var(--red)/0.15)] text-[hsl(var(--red))]' :
                  'bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))]'
                }`}>
                  {logStatus}
                </span>
              </button>
              <div className="flex items-center gap-1">
                {logStatus === 'running' && (
                  <button
                    onClick={handleCancelOperation}
                    className="px-2 py-0.5 text-[10px] text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] transition-colors"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={() => { setLogPanelOpen(false); setLogs([]); setLogStatus('idle'); }}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 bg-[hsl(var(--bg-base))] font-mono text-[11px] leading-relaxed min-h-0">
              {logs.map((entry, i) => (
                <div
                  key={i}
                  className={`${
                    entry.line.startsWith('ERROR:') || entry.line.startsWith('[stderr]')
                      ? 'text-[hsl(var(--red))]'
                      : 'text-[hsl(var(--text-secondary))]'
                  } whitespace-pre-wrap break-all`}
                >
                  {entry.line}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Shell panel (fixed overlay, right or bottom) */}
      {shellImage && (
        <div
          className={`${
            shellPosition === 'bottom'
              ? 'fixed bottom-0 left-52 right-0 border-t flex flex-col'
              : 'fixed top-0 right-0 bottom-0 border-l flex flex-row'
          } z-40 bg-[hsl(var(--bg-base))] border-[hsl(var(--border))] ${
            !isResizing ? 'transition-[width,height] duration-200 ease-out' : ''
          }`}
          style={shellPosition === 'bottom' ? { height: shellSize } : { width: shellSize }}
        >
          {/* Resize handle — right position (vertical bar on left edge) */}
          {shellPosition === 'right' && (
            <div
              className="w-2 h-full flex-shrink-0 cursor-ew-resize hover:bg-[hsl(var(--cyan)/0.3)] bg-[hsl(var(--bg-elevated))] border-l border-[hsl(var(--border))] transition-colors group flex items-center justify-center"
              onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
            >
              <GripVertical className="h-6 w-3 text-[hsl(var(--text-muted))] opacity-30 group-hover:opacity-100 transition-opacity" />
            </div>
          )}

          {/* Panel content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Resize handle — bottom position (horizontal bar on top edge) */}
            {shellPosition === 'bottom' && (
              <div
                className="h-1.5 w-full flex-shrink-0 cursor-ns-resize hover:bg-[hsl(var(--cyan)/0.5)] bg-[hsl(var(--border))] transition-colors group flex items-center justify-center"
                onMouseDown={(e) => { e.preventDefault(); setIsResizing(true); }}
              >
                <GripHorizontal className="h-3 w-6 text-[hsl(var(--text-muted))] opacity-30 group-hover:opacity-100 transition-opacity" />
              </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
              <div className="flex items-center gap-2 px-3 py-2 text-xs">
                <Terminal className="h-3.5 w-3.5 text-[hsl(var(--green))]" />
                <span className="text-[hsl(var(--text-secondary))]">
                  Shell into {shellImage}
                </span>
              </div>
              <div className="flex items-center gap-1 px-2">
                <button
                  onClick={() => setShellPosition(shellPosition === 'bottom' ? 'right' : 'bottom')}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
                  title={shellPosition === 'bottom' ? 'Move to right' : 'Move to bottom'}
                >
                  {shellPosition === 'bottom' ? (
                    <PanelRight className="h-3.5 w-3.5" />
                  ) : (
                    <PanelBottom className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  onClick={() => setShellImage(null)}
                  className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
                  title="Close shell"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Terminal */}
            <div className="flex-1 min-h-0">
              <TerminalInstance
                target={{ type: 'image', id: shellImage }}
                showStatusBar={true}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
