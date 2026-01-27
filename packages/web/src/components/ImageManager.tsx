/**
 * ImageManager - Docker images and Daytona snapshots management
 *
 * Features:
 * - Local Docker images list with Dockerfile viewer
 * - Daytona snapshots management
 * - Push local images to Daytona
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
  Pencil,
  Terminal,
} from 'lucide-react';
import { useImages } from '../hooks/useContainers';
import { useConfirm } from './ConfirmModal';
import * as api from '../api/client';

type ActiveTab = 'local' | 'daytona';

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
  const [launchingImageTag, setLaunchingImageTag] = useState<string | null>(null);
  const [pushProgress, setPushProgress] = useState<string[]>([]);

  // Daytona snapshots state
  const [daytonaSnapshots, setDaytonaSnapshots] = useState<api.DaytonaSnapshot[]>([]);
  const [isLoadingSnapshots, setIsLoadingSnapshots] = useState(false);
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(null);
  const [showDaytonaManaged, setShowDaytonaManaged] = useState<boolean>(() => {
    const saved = localStorage.getItem('caisson:show-daytona-managed');
    return saved !== 'false'; // Default to true
  });

  // Check if a snapshot is Daytona-managed (not user-created)
  const isDaytonaManaged = (snapshot: api.DaytonaSnapshot) => {
    return snapshot.imageName?.startsWith('daytonaio/') || snapshot.general;
  };

  // Format display name: remove "caisson-" prefix and timestamp/latest tags
  const formatDisplayName = (name: string): string => {
    let display = name;
    // Remove caisson- prefix
    if (display.startsWith('caisson-')) {
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
  const confirm = useConfirm();

  // Load Daytona snapshots when tab is selected
  useEffect(() => {
    if (activeTab === 'daytona') {
      loadDaytonaSnapshots();
    }
  }, [activeTab]);

  // Persist show Daytona-managed preference
  useEffect(() => {
    localStorage.setItem('caisson:show-daytona-managed', String(showDaytonaManaged));
  }, [showDaytonaManaged]);

  // Filter snapshots based on managed toggle
  const filteredSnapshots = daytonaSnapshots.filter(s => showDaytonaManaged || !isDaytonaManaged(s));

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

  const handlePushToDaytona = async (imageTag: string) => {
    if (!pushSnapshotName.trim()) return;

    setPushingImageId(imageTag);
    setShowPushModal(null);
    setPushProgress([]);

    try {
      await api.pushImageToDaytona(
        {
          localImage: imageTag,
          snapshotName: pushSnapshotName.trim(),
        },
        (message, _type) => {
          setPushProgress(prev => {
            // Keep last 10 messages for display
            const newProgress = [...prev, message].slice(-10);
            return newProgress;
          });
        }
      );
      setPushSnapshotName('');
      // Switch to Daytona tab and refresh
      setActiveTab('daytona');
      loadDaytonaSnapshots();
    } catch (error) {
      console.error('Failed to push to Daytona:', error);
      alert(`Failed to push to Daytona: ${error instanceof Error ? error.message : 'Unknown error'}`);
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

  // Launch sandbox from image
  const handleLaunchFromImage = async (imageTag: string, backend: 'docker' | 'daytona') => {
    setLaunchingImageTag(imageTag);

    // Generate a sandbox name from the image tag
    const baseName = imageTag.split(':')[0].replace(/[^a-zA-Z0-9-]/g, '-');
    const sandboxName = `${baseName}-${Date.now().toString(36)}`;

    try {
      await api.createSandbox({
        name: sandboxName,
        backend,
        image: imageTag,
      });

      // Navigate to sandboxes tab
      window.dispatchEvent(new CustomEvent('caisson-navigate-tab', { detail: { tab: 'sandboxes' } }));
    } catch (error) {
      console.error('Failed to launch sandbox:', error);
      alert(`Failed to launch sandbox: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    setLaunchingImageTag(null);
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
          {images && images.length > 0 && (
            <span className="px-1.5 py-0.5 text-[10px] bg-[hsl(var(--bg-elevated))] rounded">{images.length}</span>
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'local' && (
          <>
            {!images || images.length === 0 ? (
              <div className="text-center py-16">
                <Image className="h-12 w-12 mx-auto mb-4 text-[hsl(var(--text-muted))] opacity-30" />
                <p className="text-sm text-[hsl(var(--text-muted))]">No images built yet</p>
                <p className="text-xs text-[hsl(var(--text-muted))] mt-1">Build a Dockerfile to create an image</p>
              </div>
            ) : (
              <div className="space-y-3">
                {images.map((image) => {
                  const tag = image.repoTags[0] || 'untagged';
                  const isDeleting = deletingImageId === image.id;
                  const isPushing = pushingImageId === tag;
                  const isExpanded = expandedDockerfile === image.id;
                  const hasDockerfile = !!image.dockerfile;

                  const isRenaming = renamingImageTag === tag;
                  const isLaunching = launchingImageTag === tag;

                  return (
                    <div key={image.id} className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Image className="h-4 w-4 text-[hsl(var(--cyan))] flex-shrink-0" />
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
                                className="flex-1 px-2 py-0.5 text-sm bg-[hsl(var(--input-bg))] border border-[hsl(var(--cyan))] text-[hsl(var(--text-primary))] focus:outline-none"
                                autoFocus
                              />
                            ) : (
                              <span className="text-sm font-medium text-[hsl(var(--text-primary))] truncate" title={tag}>{formatDisplayName(tag)}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-[hsl(var(--text-muted))]">
                            <span className="flex items-center gap-1.5">
                              <HardDrive className="h-3.5 w-3.5" />
                              {formatSize(image.size)}
                            </span>
                            <span>{formatDate(image.created)}</span>
                            {image.dockerfileName && (
                              <span className="flex items-center gap-1.5 text-[hsl(var(--purple))]">
                                <FileCode className="h-3.5 w-3.5" />
                                {image.dockerfileName}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {hasDockerfile && (
                            <button
                              onClick={() => setExpandedDockerfile(isExpanded ? null : image.id)}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.1)] border border-[hsl(var(--purple)/0.3)]"
                              title="View Dockerfile"
                            >
                              <FileCode className="h-3.5 w-3.5" />
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          )}
                          <button
                            onClick={() => handleLaunchFromImage(tag, 'docker')}
                            disabled={isLaunching}
                            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))]"
                            title="Launch sandbox"
                          >
                            {isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => { setRenamingImageTag(tag); setRenameValue(formatDisplayName(tag)); }}
                            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--amber))] hover:bg-[hsl(var(--bg-elevated))]"
                            title="Rename"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => { setShowPushModal(tag); setPushSnapshotName(formatDisplayName(tag)); }}
                            disabled={isPushing}
                            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--purple))] hover:bg-[hsl(var(--bg-elevated))]"
                            title="Push to Daytona"
                          >
                            {isPushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => handleDeleteImage(image.id, tag)}
                            disabled={isDeleting}
                            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-elevated))]"
                            title="Delete"
                          >
                            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Push Modal */}
                      {showPushModal === tag && (
                        <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]">
                          <p className="text-xs text-[hsl(var(--text-muted))] mb-2">Push to Daytona as:</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={pushSnapshotName}
                              onChange={(e) => setPushSnapshotName(e.target.value)}
                              placeholder="Snapshot name"
                              className="flex-1 px-2.5 py-1.5 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
                              autoFocus
                            />
                            <button
                              onClick={() => handlePushToDaytona(tag)}
                              disabled={!pushSnapshotName.trim()}
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
                        </div>
                      )}

                      {/* Push Progress */}
                      {isPushing && pushProgress.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]">
                          <div className="flex items-center gap-2 mb-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(var(--purple))]" />
                            <span className="text-xs text-[hsl(var(--purple))]">Pushing to Daytona...</span>
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
                              className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))]"
                              title="Launch sandbox"
                            >
                              {isLaunchingSnapshot ? <Loader2 className="h-4 w-4 animate-spin" /> : <Terminal className="h-4 w-4" />}
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
      </div>
    </div>
  );
}
