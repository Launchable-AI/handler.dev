/**
 * ImageManager - Docker images, Daytona snapshots, and push history management
 *
 * Features:
 * - Local Docker images list with Dockerfile viewer
 * - Daytona snapshots management
 * - Push to multiple registries (Daytona, ECR, GCR, ACR, Docker Hub)
 * - Push history tracking
 */

import { useState, useEffect } from 'react';
import {
  Trash2,
  Loader2,
  X,
  Image,
  HardDrive,
  Upload,
  Cloud,
  RefreshCw,
  Play,
  Pause,
  Circle,
  FileCode,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Eye,
  EyeOff,
  Settings,
  History,
  Server,
  Box,
} from 'lucide-react';
import { useImages, useVmBaseImages, useDeleteVmBaseImage, useTriggerVmWarmup } from '../hooks/useContainers';
import { useConfirm } from './ConfirmModal';
import * as api from '../api/client';

type ActiveTab = 'local' | 'daytona' | 'push-history';

const REGISTRY_LABELS: Record<api.RegistryType, string> = {
  daytona: 'Daytona',
  ecr: 'AWS ECR',
  gcr: 'Google Artifact Registry',
  acr: 'Azure Container Registry',
  dockerhub: 'Docker Hub',
};

export function ImageManager() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('local');
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [pushingImageId, setPushingImageId] = useState<string | null>(null);
  const [pushSnapshotName, setPushSnapshotName] = useState('');
  const [showPushModal, setShowPushModal] = useState<string | null>(null);
  const [expandedDockerfile, setExpandedDockerfile] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renamingImageTag, setRenamingImageTag] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [launchingImageTag] = useState<string | null>(null);
  const [pushProgress, setPushProgress] = useState<string[]>([]);

  // Registry selection
  const [selectedRegistry, setSelectedRegistry] = useState<api.RegistryType>('daytona');
  const [availableRegistries, setAvailableRegistries] = useState<api.AvailableRegistry[]>([]);
  const [acrLoginServer, setAcrLoginServer] = useState('');

  // Daytona snapshots state
  const [daytonaSnapshots, setDaytonaSnapshots] = useState<api.DaytonaSnapshot[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null);
  const [showDaytonaManaged, setShowDaytonaManaged] = useState<boolean>(() => {
    const saved = localStorage.getItem('handler:show-daytona-managed');
    return saved !== 'false'; // Default to true
  });

  // Push history state
  const [pushHistory, setPushHistory] = useState<api.PushRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [deletingRecordId, setDeletingRecordId] = useState<string | null>(null);

  // Check if a snapshot is Daytona-managed (not user-created)
  const isDaytonaManaged = (snapshot: api.DaytonaSnapshot) => {
    return snapshot.imageName?.startsWith('daytonaio/') || snapshot.general;
  };

  // Format display name: remove registry paths, "handler-" prefix, and timestamp/latest tags
  const formatDisplayName = (name: string): string => {
    let display = name;
    // Remove registry path (e.g., "cr.app.daytona.io/sbox-transient/my-image" -> "my-image")
    if (display.includes('/')) {
      display = display.split('/').pop() || display;
    }
    // Remove handler- prefix
    if (display.startsWith('handler-')) {
      display = display.slice(8);
    }
    // Remove :latest tag
    if (display.endsWith(':latest')) {
      display = display.slice(0, -7);
    }
    // Remove timestamp tags like :2026-01-27T18-50-28
    const timestampMatch = display.match(/:(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})$/);
    if (timestampMatch) {
      display = display.slice(0, -timestampMatch[0].length);
    }
    return display;
  };

  const { data: images, refetch: refetchImages } = useImages();
  const { data: vmBaseImages, refetch: refetchVmBaseImages } = useVmBaseImages();
  const deleteVmBaseImage = useDeleteVmBaseImage();
  const triggerWarmup = useTriggerVmWarmup();
  const confirm = useConfirm();

  // Highlighted image (for navigation after promotion)
  const [highlightedImage, setHighlightedImage] = useState<string | null>(null);

  // Load available registries on mount
  useEffect(() => {
    loadAvailableRegistries();
  }, []);

  // Listen for navigation events with image highlight
  useEffect(() => {
    const handleHighlightImage = (e: CustomEvent<{ imageName: string }>) => {
      setActiveTab('local');
      setHighlightedImage(e.detail.imageName);
      refetchVmBaseImages();
      // Clear highlight after 3 seconds
      setTimeout(() => setHighlightedImage(null), 3000);
    };
    window.addEventListener('handler-highlight-image' as any, handleHighlightImage);
    return () => window.removeEventListener('handler-highlight-image' as any, handleHighlightImage);
  }, [refetchVmBaseImages]);

  // Load Daytona snapshots when tab is selected
  useEffect(() => {
    if (activeTab === 'daytona') {
      loadDaytonaSnapshots();
    } else if (activeTab === 'push-history') {
      loadPushHistory();
    }
  }, [activeTab]);

  // Persist show Daytona-managed preference
  useEffect(() => {
    localStorage.setItem('handler:show-daytona-managed', String(showDaytonaManaged));
  }, [showDaytonaManaged]);

  // Filter snapshots based on managed toggle
  const filteredSnapshots = daytonaSnapshots.filter(s => showDaytonaManaged || !isDaytonaManaged(s));

  const loadAvailableRegistries = async () => {
    try {
      const registries = await api.listAvailableRegistries();
      setAvailableRegistries(registries);
      // Default to first configured registry, or daytona
      const firstConfigured = registries.find(r => r.configured);
      if (firstConfigured) setSelectedRegistry(firstConfigured.type);
    } catch {
      // Ignore - will use defaults
    }
  };

  const loadDaytonaSnapshots = async () => {
    setIsLoadingSnapshots(true);
    try {
      const result = await api.listDaytonaSnapshots({ limit: 100 });
      setDaytonaSnapshots(result.items);
    } catch (err) {
      console.error('Failed to load Daytona snapshots:', err);
    }
    setIsLoadingSnapshots(false);
  };

  const loadPushHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const records = await api.listPushHistory();
      setPushHistory(records);
    } catch (err) {
      console.error('Failed to load push history:', err);
    }
    setIsLoadingHistory(false);
  };

  // Poll for a snapshot until it reaches a final state
  const pollForSnapshot = async (snapshotName: string, maxAttempts = 30, intervalMs = 2000) => {
    const finalStates = ['active', 'inactive', 'error', 'build_failed'];

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await api.listDaytonaSnapshots({ limit: 100 });
        setDaytonaSnapshots(result.items);

        // Look for our snapshot (name might have handler- prefix added)
        const snapshot = result.items.find(s =>
          s.name === snapshotName ||
          s.name === `handler-${snapshotName}` ||
          s.name.includes(snapshotName)
        );

        if (snapshot && finalStates.includes(snapshot.state)) {
          return snapshot;
        }
      } catch (err) {
        console.error('Failed to poll snapshots:', err);
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    // Final refresh even if we didn't find it in final state
    await loadDaytonaSnapshots();
    return null;
  };

  // Image operations
  const handleDeleteImage = async (id: string, tag: string) => {
    const confirmed = await confirm({
      title: 'Delete Image',
      message: `Are you sure you want to delete "${tag}"? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    setDeletingImageId(id);
    try {
      await api.removeImage(id);
      refetchImages();
    } catch (error) {
      console.error('Failed to delete image:', error);
    }
    setDeletingImageId(null);
  };

  const handlePushToRegistry = async (imageTag: string) => {
    if (!pushSnapshotName.trim()) return;

    // ACR requires login server
    if (selectedRegistry === 'acr' && !acrLoginServer.trim()) {
      alert('ACR login server is required (e.g. myregistry.azurecr.io)');
      return;
    }

    setPushingImageId(imageTag);
    setShowPushModal(null);
    setPushProgress([]);

    try {
      if (selectedRegistry === 'daytona') {
        // Use existing Daytona push flow for backward compatibility
        await api.pushImageToDaytona(
          {
            localImage: imageTag,
            snapshotName: pushSnapshotName.trim(),
          },
          (message, _type) => {
            setPushProgress(prev => [...prev, message].slice(-10));
          }
        );
        const snapshotNameToFind = pushSnapshotName.trim();
        setPushSnapshotName('');
        setActiveTab('daytona');
        await pollForSnapshot(snapshotNameToFind);
      } else {
        // Use new registry push flow
        await api.pushImageToRegistry(
          {
            localImage: imageTag,
            imageName: pushSnapshotName.trim(),
            registryType: selectedRegistry,
            acrLoginServer: selectedRegistry === 'acr' ? acrLoginServer.trim() : undefined,
          },
          (message, _type) => {
            setPushProgress(prev => [...prev, message].slice(-10));
          }
        );
        setPushSnapshotName('');
        setActiveTab('push-history');
        await loadPushHistory();
      }
    } catch (error) {
      console.error('Failed to push:', error);
      alert(`Failed to push: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    setPushingImageId(null);
    setPushProgress([]);
  };

  // Daytona snapshot operations
  const handleDeleteSnapshot = async (id: string, name: string) => {
    const confirmed = await confirm({
      title: 'Delete Daytona Snapshot',
      message: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    setDeletingSnapshotId(id);
    try {
      await api.deleteDaytonaSnapshot(id);
      loadDaytonaSnapshots();
    } catch (error) {
      console.error('Failed to delete snapshot:', error);
    }
    setDeletingSnapshotId(null);
  };

  const handleToggleSnapshotActive = async (snapshot: api.DaytonaSnapshot) => {
    try {
      if (snapshot.state === 'active') {
        await api.deactivateDaytonaSnapshot(snapshot.id);
      } else if (snapshot.state === 'inactive') {
        await api.activateDaytonaSnapshot(snapshot.id);
      }
      loadDaytonaSnapshots();
    } catch (error) {
      console.error('Failed to toggle snapshot state:', error);
    }
  };

  const handleCopyDockerfile = async (dockerfile: string, imageId: string) => {
    await navigator.clipboard.writeText(dockerfile);
    setCopiedId(imageId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Rename image
  const handleRenameImage = async (currentTag: string) => {
    const cleanCurrentTag = formatDisplayName(currentTag);
    if (!renameValue.trim() || renameValue.trim() === cleanCurrentTag) {
      setRenamingImageTag(null);
      setRenameValue('');
      return;
    }

    try {
      await api.renameImage(currentTag, renameValue.trim());
      refetchImages();
      setRenamingImageTag(null);
      setRenameValue('');
    } catch (error) {
      console.error('Failed to rename image:', error);
      alert(`Failed to rename image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Launch sandbox from image (for Docker/Daytona - opens form with pre-selected values)
  const handleLaunchFromImage = async (imageTag: string, backend: 'docker' | 'daytona') => {
    // Open create sandbox form with the selected image pre-selected
    window.dispatchEvent(new CustomEvent('handler-create-sandbox', {
      detail: { backend, image: imageTag }
    }));
  };

  // Push history operations
  const handleDeletePushRecord = async (id: string) => {
    const confirmed = await confirm({
      title: 'Delete Push Record',
      message: 'Delete this push history record?',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    setDeletingRecordId(id);
    try {
      await api.deletePushRecord(id);
      await loadPushHistory();
    } catch (error) {
      console.error('Failed to delete push record:', error);
    }
    setDeletingRecordId(null);
  };

  // Formatting helpers
  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const getSnapshotStateColor = (state: api.DaytonaSnapshotState) => {
    switch (state) {
      case 'active': return 'text-[hsl(var(--green))]';
      case 'inactive': return 'text-[hsl(var(--text-muted))]';
      case 'building':
      case 'pending':
      case 'pulling': return 'text-[hsl(var(--amber))]';
      case 'error':
      case 'build_failed': return 'text-[hsl(var(--red))]';
      default: return 'text-[hsl(var(--text-muted))]';
    }
  };

  const configuredRegistries = availableRegistries.filter(r => r.configured);

  // VM Base Image operations
  const handleDeleteVmBaseImage = async (name: string) => {
    const confirmed = await confirm({
      title: 'Delete Base Image',
      message: `Are you sure you want to delete "${name}"? This cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (confirmed) {
      deleteVmBaseImage.mutate(name);
    }
  };

  const handleWarmupVmImage = (name: string) => {
    triggerWarmup.mutate(name);
  };

  // Combine counts for tab badge
  const localImageCount = (images?.length || 0) + (vmBaseImages?.length || 0);

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        <button
          onClick={() => setActiveTab('local')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-medium transition-colors ${
            activeTab === 'local'
              ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Image className="h-4 w-4" />
          Local Images
          {localImageCount > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-[hsl(var(--bg-elevated))] rounded">{localImageCount}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('daytona')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-medium transition-colors ${
            activeTab === 'daytona'
              ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <Cloud className="h-4 w-4" />
          Daytona Snapshots
          {daytonaSnapshots.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-[hsl(var(--bg-elevated))] rounded">{daytonaSnapshots.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('push-history')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-medium transition-colors ${
            activeTab === 'push-history'
              ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          <History className="h-4 w-4" />
          Push History
          {pushHistory.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-[hsl(var(--bg-elevated))] rounded">{pushHistory.length}</span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'local' && (
          <>
            {localImageCount === 0 ? (
              <div className="text-center py-16">
                <Image className="h-12 w-12 mx-auto mb-4 text-[hsl(var(--text-muted))] opacity-30" />
                <p className="text-sm text-[hsl(var(--text-muted))]">No images yet</p>
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">Build a Dockerfile or promote a VM snapshot</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* VM Base Images */}
                {vmBaseImages && vmBaseImages.length > 0 && (
                  <>
                    <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-2 flex items-center gap-2">
                      <Server className="h-3 w-3" />
                      VM Base Images ({vmBaseImages.length})
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-4">
                      {vmBaseImages.map((vmImage) => {
                        const isHighlighted = highlightedImage === vmImage.name;
                        const isDeleting = deleteVmBaseImage.isPending && deleteVmBaseImage.variables === vmImage.name;

                        return (
                          <div
                            key={vmImage.name}
                            className={`p-4 bg-[hsl(var(--bg-surface))] border hover:border-[hsl(var(--border-highlight))] transition-all ${
                              isHighlighted
                                ? 'border-[hsl(var(--cyan))] ring-2 ring-[hsl(var(--cyan)/0.3)] animate-pulse'
                                : 'border-[hsl(var(--border))]'
                            }`}
                          >
                            {/* Header */}
                            <div className="flex items-start gap-2 mb-2">
                              <Server className="h-4 w-4 text-[hsl(var(--purple))] flex-shrink-0 mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-[hsl(var(--text-primary))] truncate">{vmImage.name}</div>
                              </div>
                            </div>

                            {/* Badges */}
                            <div className="flex flex-wrap gap-1.5 mb-3">
                              <span className="px-1.5 py-0.5 text-[8px] bg-[hsl(var(--purple)/0.1)] text-[hsl(var(--purple))] border border-[hsl(var(--purple)/0.2)]">
                                VM
                              </span>
                              {vmImage.hasWarmupSnapshot && (
                                <span className="px-1.5 py-0.5 text-[8px] bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">
                                  FAST BOOT
                                </span>
                              )}
                              {vmImage.isLayered && (
                                <span className="px-1.5 py-0.5 text-[8px] bg-[hsl(var(--amber)/0.1)] text-[hsl(var(--amber))] border border-[hsl(var(--amber)/0.2)]">
                                  LAYERED
                                </span>
                              )}
                              {vmImage.hasKernel && (
                                <span className="px-1.5 py-0.5 text-[8px] bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">
                                  KERNEL
                                </span>
                              )}
                            </div>

                            {/* Details */}
                            <div className="text-xs text-[hsl(var(--text-muted))] space-y-0.5 mb-3">
                              {vmImage.isLayered && vmImage.parent && (
                                <div>Parent: <span className="text-[hsl(var(--text-secondary))]">{vmImage.parent}</span></div>
                              )}
                              {vmImage.layerSizeMB !== undefined && (
                                <div>{vmImage.layerSizeMB} MB layer</div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => {
                                  window.dispatchEvent(new CustomEvent('handler-create-sandbox', {
                                    detail: { backend: 'firecracker', image: vmImage.name }
                                  }));
                                }}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)]"
                                title="Create a new VM from this base image"
                              >
                                <Play className="h-3 w-3" />
                                Launch
                              </button>
                              {!vmImage.hasWarmupSnapshot && (
                                <button
                                  onClick={() => handleWarmupVmImage(vmImage.name)}
                                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
                                  title="Create fast boot cache"
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  Warmup
                                </button>
                              )}
                              <button
                                onClick={() => handleDeleteVmBaseImage(vmImage.name)}
                                disabled={isDeleting}
                                className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] ml-auto"
                                title="Delete"
                              >
                                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Docker Images */}
                {images && images.length > 0 && (
                  <>
                    <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-2 mt-4 flex items-center gap-2">
                      <Box className="h-3 w-3" />
                      Docker Images ({images.length})
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {images.map((image) => {
                  const tag = image.repoTags[0] || 'untagged';
                  const isDeleting = deletingImageId === image.id;
                  const isPushing = pushingImageId === tag;
                  const isExpanded = expandedDockerfile === image.id;
                  const hasDockerfile = !!image.dockerfile;
                  const hasExpandedContent = showPushModal === tag || isPushing || isExpanded;

                  const isRenaming = renamingImageTag === tag;
                  const isLaunching = launchingImageTag === tag;

                  return (
                    <div key={image.id} className={`p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))] ${
                      hasExpandedContent ? 'col-span-full' : ''
                    }`}>
                      {/* Header */}
                      <div className="flex items-start gap-2 mb-2">
                        <Image className="h-4 w-4 text-[hsl(var(--cyan))] flex-shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          {isRenaming ? (
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => handleRenameImage(tag)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameImage(tag);
                                if (e.key === 'Escape') { setRenamingImageTag(null); setRenameValue(''); }
                              }}
                              className="w-full px-2 py-0.5 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--cyan))] text-[hsl(var(--text-primary))] focus:outline-none"
                              autoFocus
                            />
                          ) : (
                            <button
                              onClick={() => { setRenamingImageTag(tag); setRenameValue(formatDisplayName(tag)); }}
                              className="text-sm font-medium text-[hsl(var(--text-primary))] truncate hover:text-[hsl(var(--cyan))] text-left block"
                              title="Click to rename"
                            >
                              {formatDisplayName(tag)}
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Details */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[hsl(var(--text-muted))] mb-3">
                        <span className="font-mono opacity-60" title={image.id}>
                          {image.id.replace('sha256:', '').slice(0, 12)}
                        </span>
                        <span className="flex items-center gap-1">
                          <HardDrive className="h-3 w-3" />
                          {formatSize(image.size)}
                        </span>
                        <span>{formatDate(image.created)}</span>
                        {image.dockerfileName && (
                          <span className="flex items-center gap-1 text-[hsl(var(--purple))]">
                            <FileCode className="h-3 w-3" />
                            {image.dockerfileName}
                          </span>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5">
                        {hasDockerfile && (
                          <button
                            onClick={() => setExpandedDockerfile(isExpanded ? null : image.id)}
                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.1)] border border-[hsl(var(--purple)/0.3)]"
                            title="View Dockerfile"
                          >
                            <FileCode className="h-3 w-3" />
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                        )}
                        <button
                          onClick={() => handleLaunchFromImage(tag, 'docker')}
                          disabled={isLaunching}
                          className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
                          title="Create a new Docker sandbox from this image"
                        >
                          {isLaunching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          Launch
                        </button>
                        <button
                          onClick={() => { setShowPushModal(tag); setPushSnapshotName(formatDisplayName(tag)); }}
                          disabled={isPushing}
                          className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--purple))] hover:bg-[hsl(var(--bg-elevated))]"
                          title="Push to Registry"
                        >
                          {isPushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          onClick={() => handleDeleteImage(image.id, tag)}
                          disabled={isDeleting}
                          className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))] ml-auto"
                          title="Delete"
                        >
                          {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </div>

                      {/* Push Modal */}
                      {showPushModal === tag && (
                        <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]">
                          <p className="text-xs text-[hsl(var(--text-muted))] mb-2">Push to registry:</p>

                          {/* Registry selector */}
                          <div className="mb-2">
                            <select
                              value={selectedRegistry}
                              onChange={(e) => setSelectedRegistry(e.target.value as api.RegistryType)}
                              className="w-full px-2.5 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                            >
                              {availableRegistries.map((r) => (
                                <option key={r.type} value={r.type} disabled={!r.configured}>
                                  {r.label}{r.configured ? '' : ' (not configured)'}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* ACR login server input */}
                          {selectedRegistry === 'acr' && (
                            <div className="mb-2">
                              <input
                                type="text"
                                value={acrLoginServer}
                                onChange={(e) => setAcrLoginServer(e.target.value)}
                                placeholder="myregistry.azurecr.io"
                                className="w-full px-2.5 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                              />
                            </div>
                          )}

                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={pushSnapshotName}
                              onChange={(e) => setPushSnapshotName(e.target.value)}
                              placeholder={selectedRegistry === 'daytona' ? 'Snapshot name' : 'Image name'}
                              className="flex-1 px-2.5 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                              autoFocus
                            />
                            <button
                              onClick={() => handlePushToRegistry(tag)}
                              disabled={!pushSnapshotName.trim() || (selectedRegistry === 'acr' && !acrLoginServer.trim())}
                              className="px-3 py-1.5 text-xs bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] disabled:opacity-50"
                            >
                              Push
                            </button>
                            <button
                              onClick={() => { setShowPushModal(null); setPushSnapshotName(''); }}
                              className="p-1.5 text-[hsl(var(--text-muted))]"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>

                          {configuredRegistries.length === 0 && (
                            <p className="text-[10px] text-[hsl(var(--amber))] mt-2">
                              No registries configured. Configure backends in Settings.
                            </p>
                          )}
                        </div>
                      )}

                      {/* Push Progress */}
                      {isPushing && pushProgress.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]">
                          <div className="flex items-center gap-2 mb-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--purple))]" />
                            <span className="text-xs text-[hsl(var(--purple))]">Pushing to {REGISTRY_LABELS[selectedRegistry] || selectedRegistry}...</span>
                          </div>
                          <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] max-h-32 overflow-y-auto font-mono text-[10px] text-[hsl(var(--text-muted))]">
                            {pushProgress.map((msg, i) => (
                              <div key={i} className="py-0.5">{msg}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Expanded Dockerfile */}
                      {isExpanded && image.dockerfile && (
                        <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">Dockerfile</span>
                            <button
                              onClick={() => handleCopyDockerfile(image.dockerfile!, image.id)}
                              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
                            >
                              {copiedId === image.id ? <><Check className="h-3 w-3 text-[hsl(var(--green))]" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}
                            </button>
                          </div>
                          <pre className="p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-xs text-[hsl(var(--text-secondary))] overflow-x-auto max-h-64 overflow-y-auto font-mono leading-relaxed">
                            {image.dockerfile}
                          </pre>
                        </div>
                      )}
                    </div>
                    );
                    })}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {activeTab === 'daytona' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">Daytona Snapshots</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDaytonaManaged(!showDaytonaManaged)}
                  className={`flex items-center gap-1.5 px-2 py-1 text-xs border ${
                    showDaytonaManaged
                      ? 'text-[hsl(var(--purple))] border-[hsl(var(--purple)/0.3)]'
                      : 'text-[hsl(var(--text-muted))] border-[hsl(var(--border))]'
                  }`}
                  title={showDaytonaManaged ? 'Hide Daytona-managed snapshots' : 'Show Daytona-managed snapshots'}
                >
                  {showDaytonaManaged ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  Managed
                </button>
                <button
                  onClick={loadDaytonaSnapshots}
                  disabled={isLoadingSnapshots}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
                  title="Refresh"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isLoadingSnapshots ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            {isLoadingSnapshots && daytonaSnapshots.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--text-muted))]" />
              </div>
            ) : filteredSnapshots.length === 0 ? (
              <div className="text-center py-16">
                <Cloud className="h-12 w-12 mx-auto mb-4 text-[hsl(var(--text-muted))] opacity-30" />
                <p className="text-sm text-[hsl(var(--text-muted))]">No Daytona snapshots</p>
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
                  {daytonaSnapshots.length > 0 && !showDaytonaManaged
                    ? 'Enable "Managed" toggle to see Daytona system snapshots'
                    : 'Push a local image to create one'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredSnapshots.map((snapshot) => {
                  const isDeleting = deletingSnapshotId === snapshot.id;
                  const isManaged = isDaytonaManaged(snapshot);
                  const isLaunchingSnapshot = launchingImageTag === snapshot.name;
                  const canLaunch = snapshot.state === 'active';

                  return (
                    <div key={snapshot.id} className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {isManaged ? (
                              <Settings className="h-3.5 w-3.5 text-[hsl(var(--purple))]" />
                            ) : (
                              <Circle className={`h-2.5 w-2.5 ${getSnapshotStateColor(snapshot.state)} fill-current`} />
                            )}
                            <span className="text-sm font-medium text-[hsl(var(--text-primary))] truncate" title={snapshot.name}>{formatDisplayName(snapshot.name)}</span>
                            {isManaged && (
                              <span className="px-1 py-0.5 text-[8px] bg-[hsl(var(--purple)/0.1)] text-[hsl(var(--purple))] border border-[hsl(var(--purple)/0.2)]">
                                managed
                              </span>
                            )}
                            <span className={`text-xs ${getSnapshotStateColor(snapshot.state)}`}>{snapshot.state}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-xs text-[hsl(var(--text-muted))]">
                            <span>{snapshot.cpu} vCPU</span>
                            <span>{snapshot.mem} GB RAM</span>
                            <span>{snapshot.disk} GB Disk</span>
                          </div>
                          {snapshot.imageName && (
                            <div className="mt-1.5 text-xs text-[hsl(var(--text-muted))] truncate" title={snapshot.imageName}>
                              Image: {formatDisplayName(snapshot.imageName.split('/').pop() || '')}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {canLaunch && (
                            <button
                              onClick={() => handleLaunchFromImage(snapshot.name, 'daytona')}
                              disabled={isLaunchingSnapshot}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
                              title="Create a new Daytona sandbox from this snapshot"
                            >
                              {isLaunchingSnapshot ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                              Launch
                            </button>
                          )}
                          {!isManaged && (snapshot.state === 'active' || snapshot.state === 'inactive') && (
                            <button
                              onClick={() => handleToggleSnapshotActive(snapshot)}
                              className={`flex items-center gap-1 px-2 py-1 text-xs border ${
                                snapshot.state === 'active'
                                  ? 'text-[hsl(var(--amber))] border-[hsl(var(--amber)/0.3)] hover:bg-[hsl(var(--amber)/0.1)]'
                                  : 'text-[hsl(var(--green))] border-[hsl(var(--green)/0.3)] hover:bg-[hsl(var(--green)/0.1)]'
                              }`}
                              title={snapshot.state === 'active' ? 'Deactivate' : 'Activate'}
                            >
                              {snapshot.state === 'active' ? <><Pause className="h-3.5 w-3.5" />Deactivate</> : <><Play className="h-3.5 w-3.5" />Activate</>}
                            </button>
                          )}
                          {!isManaged && (
                            <button
                              onClick={() => handleDeleteSnapshot(snapshot.id, snapshot.name)}
                              disabled={isDeleting}
                              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))]"
                              title="Delete"
                            >
                              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {activeTab === 'push-history' && (
          <>
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">Push History</span>
              <button
                onClick={loadPushHistory}
                disabled={isLoadingHistory}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
                title="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>

            {isLoadingHistory && pushHistory.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--text-muted))]" />
              </div>
            ) : pushHistory.length === 0 ? (
              <div className="text-center py-16">
                <History className="h-12 w-12 mx-auto mb-4 text-[hsl(var(--text-muted))] opacity-30" />
                <p className="text-sm text-[hsl(var(--text-muted))]">No push history</p>
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">Push an image to a registry to see it here</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pushHistory.map((record) => {
                  const isDeleting = deletingRecordId === record.id;

                  return (
                    <div key={record.id} className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Upload className="h-3.5 w-3.5 text-[hsl(var(--purple))] flex-shrink-0" />
                            <span className="text-sm font-medium text-[hsl(var(--text-primary))] truncate" title={record.remoteImage}>
                              {formatDisplayName(record.imageName)}
                            </span>
                            <span className="px-1 py-0.5 text-[8px] bg-[hsl(var(--purple)/0.1)] text-[hsl(var(--purple))] border border-[hsl(var(--purple)/0.2)]">
                              {REGISTRY_LABELS[record.registryType] || record.registryType}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-xs text-[hsl(var(--text-muted))]">
                            <span>From: {formatDisplayName(record.localImage)}</span>
                            <span>{formatDateTime(record.pushedAt)}</span>
                          </div>
                          <div className="mt-1.5 text-xs text-[hsl(var(--text-muted))] truncate font-mono" title={record.remoteImage}>
                            {record.remoteImage}
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeletePushRecord(record.id)}
                          disabled={isDeleting}
                          className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))]"
                          title="Delete record"
                        >
                          {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
