import { useState, useMemo, useEffect } from 'react';
import { Plus, Server, AlertTriangle, Terminal, Play, Square, Trash2, Copy, Download, Cpu, MemoryStick, HardDrive, Network, Loader2, ScrollText, Check, Camera, ChevronDown, ChevronRight, TerminalSquare, LayoutGrid, LayoutList, Rows3, Zap, Flame, Cloud, FolderOpen, Globe, ExternalLink, Pencil, X, RotateCcw } from 'lucide-react';
import { useVms, useStartVm, useStopVm, useDeleteVm, useVmNetworkStatus, useCreateVm, useVmBaseImages, useConfig, useVolumes, useVmSnapshots, useCreateVmSnapshot, useDeleteVmSnapshot, useUpdateVmPorts, useRollbackVmToSnapshot } from '../hooks/useContainers';
import { VmInfo, downloadVmSshKey, VmSnapshotInfo, HypervisorType, getBackendStatus, BackendStatus, DaytonaSizeClass, DAYTONA_SIZE_PRESETS } from '../api/client';
import { useConfirm } from './ConfirmModal';
import { LogViewer } from './LogViewer';
import { VMFileBrowser } from './VMFileBrowser';
import { useTerminalPanel } from './TerminalPanel';

interface VMListProps {
  onCreateClick: () => void;
}

type ConnectionMode = 'remote' | 'local';
type ViewMode = 'compact' | 'detailed' | 'list';

// Compact card view - minimal info, smaller footprint
function VMCardCompact({ vm }: { vm: VmInfo }) {
  const startVm = useStartVm();
  const stopVm = useStopVm();
  const deleteVm = useDeleteVm();
  const updatePorts = useUpdateVmPorts();
  const confirm = useConfirm();
  const terminalPanel = useTerminalPanel();
  const [showLogs, setShowLogs] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingPorts, setEditingPorts] = useState(false);
  const [editPorts, setEditPorts] = useState<Array<{ container: number; host: number }>>([]);

  const isRunning = vm.status === 'running';
  const isBooting = vm.status === 'booting' || vm.status === 'creating';
  const hasError = vm.status === 'error';

  // Use SSH command from server
  const sshCommand = isRunning ? vm.sshCommand : null;

  const copySshCommand = async () => {
    if (!sshCommand) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(sshCommand);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = sshCommand;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleStart = async () => {
    try {
      await startVm.mutateAsync(vm.id);
    } catch (error) {
      console.error('Failed to start VM:', error);
    }
  };

  const handleStop = async () => {
    try {
      await stopVm.mutateAsync(vm.id);
    } catch (error) {
      console.error('Failed to stop VM:', error);
    }
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete VM',
      message: `Are you sure you want to delete "${vm.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) {
      try {
        await deleteVm.mutateAsync(vm.id);
      } catch (error) {
        console.error('Failed to delete VM:', error);
      }
    }
  };

  const statusColor = isRunning
    ? 'text-[hsl(var(--green))]'
    : isBooting
    ? 'text-[hsl(var(--amber))]'
    : hasError
    ? 'text-[hsl(var(--red))]'
    : 'text-[hsl(var(--text-muted))]';

  return (
    <div className="p-3 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))] transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Server className={`h-4 w-4 flex-shrink-0 ${statusColor}`} />
          <span className="text-sm font-medium text-[hsl(var(--text-primary))] truncate">{vm.name}</span>
        </div>
        <span className={`text-[10px] uppercase tracking-wider ${statusColor}`}>
          {isBooting && <Loader2 className="h-3 w-3 animate-spin inline mr-1" />}
          {vm.status}
        </span>
      </div>

      {/* Specs */}
      <div className="flex items-center gap-3 text-[10px] text-[hsl(var(--text-muted))] mb-3">
        <span className="flex items-center gap-1">
          <Cpu className="h-3 w-3" />
          {vm.vcpus}
        </span>
        <span className="flex items-center gap-1">
          <MemoryStick className="h-3 w-3" />
          {vm.memoryMb}MB
        </span>
        {vm.guestIp && (
          <span className="flex items-center gap-1">
            <Network className="h-3 w-3" />
            {vm.guestIp}
          </span>
        )}
        {vm.hypervisor && (
          <span className={`flex items-center gap-1 ${
            vm.hypervisor === 'firecracker' ? 'text-[hsl(var(--purple))]' :
            vm.hypervisor === 'daytona' ? 'text-[hsl(var(--amber))]' :
            'text-[hsl(var(--cyan))]'
          }`} title={
            vm.hypervisor === 'firecracker' ? 'Firecracker' :
            vm.hypervisor === 'daytona' ? 'Daytona Cloud' :
            'Cloud-Hypervisor'
          }>
            {vm.hypervisor === 'firecracker' ? <Flame className="h-3 w-3" /> :
             vm.hypervisor === 'daytona' ? <Globe className="h-3 w-3" /> :
             <Cloud className="h-3 w-3" />}
          </span>
        )}
      </div>

      {/* Port Shortcuts */}
      {isRunning && vm.guestIp && (
        <div className="mb-3">
          {editingPorts ? (
            <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-[hsl(var(--text-muted))]">Port Shortcuts</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditPorts([...editPorts, { container: 8080, host: 8080 }])}
                    className="p-0.5 text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)]"
                    title="Add port"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => {
                      updatePorts.mutate({ vmId: vm.id, ports: editPorts });
                      setEditingPorts(false);
                    }}
                    disabled={updatePorts.isPending}
                    className="p-0.5 text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)]"
                    title="Save"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setEditingPorts(false)}
                    className="p-0.5 text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--bg-elevated))]"
                    title="Cancel"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {editPorts.map((port, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <input
                      type="number"
                      value={port.container}
                      onChange={e => {
                        const newPorts = [...editPorts];
                        newPorts[idx] = { ...port, container: Number(e.target.value), host: Number(e.target.value) };
                        setEditPorts(newPorts);
                      }}
                      className="w-16 px-1 py-0.5 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] text-[10px] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                      min={1}
                      max={65535}
                    />
                    <button
                      onClick={() => setEditPorts(editPorts.filter((_, i) => i !== idx))}
                      className="p-0.5 text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)]"
                      title="Remove"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
                {editPorts.length === 0 && (
                  <p className="text-[9px] text-[hsl(var(--text-muted))] italic">No shortcuts. Click + to add.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[10px] flex-wrap">
              <Globe className="h-3 w-3 text-[hsl(var(--text-muted))]" />
              {vm.ports && vm.ports.length > 0 ? (
                <>
                  {vm.ports.map((port, idx) => (
                    <a
                      key={idx}
                      href={`http://${vm.guestIp}:${port.container}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-0.5 text-[hsl(var(--cyan))] hover:text-[hsl(var(--cyan)/0.8)] transition-colors"
                      title={`Open http://${vm.guestIp}:${port.container}`}
                    >
                      :{port.container}
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  ))}
                </>
              ) : (
                <span className="text-[hsl(var(--text-muted))] italic">No shortcuts</span>
              )}
              <button
                onClick={() => {
                  setEditPorts(vm.ports || []);
                  setEditingPorts(true);
                }}
                className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
                title="Edit port shortcuts"
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1">
        {isRunning || isBooting ? (
          <button
            onClick={handleStop}
            disabled={stopVm.isPending}
            className="p-1.5 text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
            title={isBooting ? 'Kill' : 'Stop'}
          >
            <Square className="h-3 w-3" />
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={startVm.isPending}
            className="p-1.5 text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
            title="Start"
          >
            <Play className="h-3 w-3" />
          </button>
        )}

        {(isBooting || isRunning || hasError) && (
          <button
            onClick={() => setShowLogs(true)}
            className="p-1.5 text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)]"
            title="View logs"
          >
            <ScrollText className="h-3 w-3" />
          </button>
        )}

        {isRunning && vm.guestIp && (
          <>
            <button
              onClick={() => terminalPanel.openTerminal(vm.id, vm.name, vm.guestIp!)}
              className="p-1.5 text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)]"
              title="Open terminal"
            >
              <TerminalSquare className="h-3 w-3" />
            </button>
            <button
              onClick={() => setShowFiles(true)}
              className="p-1.5 text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
              title="Browse files"
            >
              <FolderOpen className="h-3 w-3" />
            </button>
          </>
        )}

        {sshCommand && (
          <button
            onClick={copySshCommand}
            className="p-1.5 text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
            title="Copy SSH command"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          </button>
        )}

        <div className="flex-1" />

        <button
          onClick={handleDelete}
          disabled={deleteVm.isPending || isRunning}
          className={`p-1.5 border ${
            isRunning
              ? 'text-[hsl(var(--text-muted))] border-[hsl(var(--border))] cursor-not-allowed opacity-50'
              : 'text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border-[hsl(var(--red)/0.3)]'
          }`}
          title={isRunning ? 'Stop VM before deleting' : 'Delete VM'}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Log Viewer */}
      {showLogs && (
        <LogViewer
          vmId={vm.id}
          title={vm.name}
          onClose={() => setShowLogs(false)}
        />
      )}

      {/* File Browser Modal */}
      {showFiles && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-3xl h-[70vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-[hsl(var(--border))]">
              <h3 className="font-medium text-[hsl(var(--text-primary))]">
                Files - {vm.name}
              </h3>
              <button
                onClick={() => setShowFiles(false)}
                className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <VMFileBrowser vmId={vm.id} vmName={vm.name} isRunning={isRunning} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// List view - table format for many VMs
function VMListView({ vms }: { vms: VmInfo[] }) {
  const startVm = useStartVm();
  const stopVm = useStopVm();
  const deleteVm = useDeleteVm();
  const confirm = useConfirm();
  const terminalPanel = useTerminalPanel();
  const [showLogsFor, setShowLogsFor] = useState<string | null>(null);
  const [showFilesFor, setShowFilesFor] = useState<string | null>(null);
  const [copiedVmId, setCopiedVmId] = useState<string | null>(null);

  // Get SSH command from VM (provided by server)
  const getSshCommand = (vm: VmInfo) => {
    if (vm.status !== 'running') return null;
    return vm.sshCommand || null;
  };

  const copySshCommand = async (vm: VmInfo) => {
    const cmd = getSshCommand(vm);
    if (!cmd) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(cmd);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = cmd;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopiedVmId(vm.id);
      setTimeout(() => setCopiedVmId(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleStart = async (vmId: string) => {
    try {
      await startVm.mutateAsync(vmId);
    } catch (error) {
      console.error('Failed to start VM:', error);
    }
  };

  const handleStop = async (vmId: string) => {
    try {
      await stopVm.mutateAsync(vmId);
    } catch (error) {
      console.error('Failed to stop VM:', error);
    }
  };

  const handleDelete = async (vm: VmInfo) => {
    const confirmed = await confirm({
      title: 'Delete VM',
      message: `Are you sure you want to delete "${vm.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (confirmed) {
      try {
        await deleteVm.mutateAsync(vm.id);
      } catch (error) {
        console.error('Failed to delete VM:', error);
      }
    }
  };

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs">
        <thead className="bg-[hsl(var(--bg-surface))] sticky top-0">
          <tr className="border-b border-[hsl(var(--border))]">
            <th className="text-left px-3 py-2 text-[hsl(var(--text-muted))] font-medium uppercase tracking-wider">Name</th>
            <th className="text-left px-3 py-2 text-[hsl(var(--text-muted))] font-medium uppercase tracking-wider">Status</th>
            <th className="text-left px-3 py-2 text-[hsl(var(--text-muted))] font-medium uppercase tracking-wider">CPU</th>
            <th className="text-left px-3 py-2 text-[hsl(var(--text-muted))] font-medium uppercase tracking-wider">Memory</th>
            <th className="text-left px-3 py-2 text-[hsl(var(--text-muted))] font-medium uppercase tracking-wider">IP</th>
            <th className="text-right px-3 py-2 text-[hsl(var(--text-muted))] font-medium uppercase tracking-wider">Actions</th>
          </tr>
        </thead>
        <tbody>
          {vms.map(vm => {
            const isRunning = vm.status === 'running';
            const isBooting = vm.status === 'booting' || vm.status === 'creating';
            const hasError = vm.status === 'error';
            const statusColor = isRunning
              ? 'text-[hsl(var(--green))]'
              : isBooting
              ? 'text-[hsl(var(--amber))]'
              : hasError
              ? 'text-[hsl(var(--red))]'
              : 'text-[hsl(var(--text-muted))]';

            return (
              <tr key={vm.id} className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-elevated))]">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <Server className={`h-3.5 w-3.5 ${statusColor}`} />
                    <span className="text-[hsl(var(--text-primary))] font-medium">{vm.name}</span>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <span className={`uppercase tracking-wider ${statusColor}`}>
                    {isBooting && <Loader2 className="h-3 w-3 animate-spin inline mr-1" />}
                    {vm.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-[hsl(var(--text-secondary))]">{vm.vcpus} vCPU</td>
                <td className="px-3 py-2 text-[hsl(var(--text-secondary))]">{vm.memoryMb} MB</td>
                <td className="px-3 py-2 text-[hsl(var(--text-secondary))] font-mono">{vm.guestIp || '-'}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    {isRunning || isBooting ? (
                      <button
                        onClick={() => handleStop(vm.id)}
                        disabled={stopVm.isPending}
                        className="p-1 text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] disabled:opacity-50"
                        title={isBooting ? 'Kill' : 'Stop'}
                      >
                        <Square className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        onClick={() => handleStart(vm.id)}
                        disabled={startVm.isPending}
                        className="p-1 text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] disabled:opacity-50"
                        title="Start"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {(isBooting || isRunning || hasError) && (
                      <button
                        onClick={() => setShowLogsFor(vm.id)}
                        className="p-1 text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)]"
                        title="View logs"
                      >
                        <ScrollText className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {isRunning && vm.guestIp && (
                      <>
                        <button
                          onClick={() => terminalPanel.openTerminal(vm.id, vm.name, vm.guestIp!)}
                          className="p-1 text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)]"
                          title="Open terminal"
                        >
                          <TerminalSquare className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setShowFilesFor(vm.id)}
                          className="p-1 text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)]"
                          title="Browse and upload files"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}

                    {getSshCommand(vm) && (
                      <button
                        onClick={() => copySshCommand(vm)}
                        className="p-1 text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)]"
                        title="Copy SSH command"
                      >
                        {copiedVmId === vm.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(vm)}
                      disabled={deleteVm.isPending || isRunning}
                      className={`p-1 ${
                        isRunning
                          ? 'text-[hsl(var(--text-muted))] cursor-not-allowed opacity-50'
                          : 'text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)]'
                      }`}
                      title={isRunning ? 'Stop VM before deleting' : 'Delete VM'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Log Viewer */}
      {showLogsFor && (
        <LogViewer
          vmId={showLogsFor}
          title={vms.find(v => v.id === showLogsFor)?.name || 'VM'}
          onClose={() => setShowLogsFor(null)}
        />
      )}

      {/* File Browser Modal */}
      {showFilesFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-4xl h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
              <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
                Files - {vms.find(v => v.id === showFilesFor)?.name || 'VM'}
              </h3>
              <button
                onClick={() => setShowFilesFor(null)}
                className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <VMFileBrowser
                vmId={showFilesFor}
                vmName={vms.find(v => v.id === showFilesFor)?.name || 'VM'}
                isRunning={vms.find(v => v.id === showFilesFor)?.status === 'running'}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Full detailed card view (original)
function VMCard({ vm }: { vm: VmInfo }) {
  const startVm = useStartVm();
  const stopVm = useStopVm();
  const deleteVm = useDeleteVm();
  const createVm = useCreateVm();
  const updatePorts = useUpdateVmPorts();
  const confirm = useConfirm();
  const { data: config } = useConfig();
  const terminalPanel = useTerminalPanel();
  const [showLogs, setShowLogs] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [copied, setCopied] = useState(false);
  const [keyDownloaded, setKeyDownloaded] = useState(false);
  const [showChmodHint, setShowChmodHint] = useState(false);
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('remote');
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');
  const [editingPorts, setEditingPorts] = useState(false);
  const [editPorts, setEditPorts] = useState<Array<{ container: number; host: number }>>([]);
  const [launchingSnapshot, setLaunchingSnapshot] = useState<string | null>(null);
  const [rollingBackSnapshot, setRollingBackSnapshot] = useState<string | null>(null);

  // Snapshot hooks
  const { data: snapshots, isLoading: snapshotsLoading } = useVmSnapshots(vm.id);
  const createSnapshot = useCreateVmSnapshot();
  const deleteSnapshot = useDeleteVmSnapshot();
  const rollbackSnapshot = useRollbackVmToSnapshot();

  const isRunning = vm.status === 'running';
  const isBooting = vm.status === 'booting' || vm.status === 'creating';
  const hasError = vm.status === 'error';

  // Check if remote mode is available (jump host configured)
  const hasJumpHost = !!(config?.sshJumpHost && config?.sshJumpHostKeyPath);
  const isTapMode = vm.networkMode === 'tap' && vm.guestIp;

  // Generate SSH command - use server-provided command for local, construct for remote with jump host
  const sshCommand = useMemo(() => {
    // Local mode: use server-provided SSH command
    if (connectionMode === 'local') {
      return vm.sshCommand || null;
    }

    // Remote mode: use ProxyCommand through jump host
    const jumpHost = config?.sshJumpHost || '';
    const jumpHostKeyPath = config?.sshJumpHostKeyPath || '';

    if (isTapMode && jumpHost && jumpHostKeyPath && vm.guestIp) {
      const user = vm.sshUser || 'agent';
      // Use ProxyCommand format for proper key handling on both hops
      // Note: This assumes the same SSH key is synced to the jump host
      return `ssh -o ProxyCommand="ssh -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i ${jumpHostKeyPath} -W %h:%p ${jumpHost}" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes -i ~/.local/share/handler/ssh-keys/id_ed25519 ${user}@${vm.guestIp}`;
    }

    // Fallback: use server-provided command
    return vm.sshCommand || null;
  }, [vm, config, connectionMode, isTapMode]);

  const statusColors: Record<string, string> = {
    running: 'bg-[hsl(var(--green))]',
    booting: 'bg-[hsl(var(--yellow))]',
    creating: 'bg-[hsl(var(--yellow))]',
    stopped: 'bg-[hsl(var(--text-muted))]',
    paused: 'bg-[hsl(var(--cyan))]',
    error: 'bg-[hsl(var(--red))]',
  };

  const handleStart = () => {
    startVm.mutate(vm.id);
  };

  const handleStop = () => {
    stopVm.mutate(vm.id);
  };

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Delete VM',
      message: `Are you sure you want to delete "${vm.name}"? This will delete all VM data including disk images.`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      deleteVm.mutate(vm.id);
    }
  };

  const handleCreateSnapshot = async () => {
    const name = snapshotName.trim() || `Snapshot ${new Date().toLocaleString()}`;
    try {
      await createSnapshot.mutateAsync({ vmId: vm.id, name });
      setSnapshotName('');
    } catch (error) {
      console.error('Failed to create snapshot:', error);
    }
  };

  const handleDeleteSnapshot = async (snapshot: VmSnapshotInfo) => {
    const confirmed = await confirm({
      title: 'Delete Snapshot',
      message: `Are you sure you want to delete "${snapshot.name || snapshot.id}"?`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      deleteSnapshot.mutate({ vmId: vm.id, snapshotId: snapshot.id });
    }
  };

  const handleLaunchFromSnapshot = async (snapshot: VmSnapshotInfo) => {
    setLaunchingSnapshot(snapshot.id);
    try {
      // Generate a unique name based on snapshot name or VM name
      const baseName = (snapshot.name || vm.name).replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase().slice(0, 20);
      const vmName = `${baseName}-${Date.now().toString(36)}`;

      await createVm.mutateAsync({
        name: vmName,
        fromSnapshot: {
          vmId: vm.id,
          snapshotId: snapshot.id,
        },
        autoStart: true,
      });
    } catch (error) {
      console.error('Failed to launch from snapshot:', error);
    } finally {
      setLaunchingSnapshot(null);
    }
  };

  const handleRollbackToSnapshot = async (snapshot: VmSnapshotInfo) => {
    const confirmed = await confirm({
      title: 'Rollback VM',
      message: `This will restore "${vm.name}" to the state saved in "${snapshot.name || snapshot.id}". The VM will be stopped and its current disk state will be replaced. Continue?`,
      confirmText: 'Rollback',
      variant: 'danger',
    });

    if (confirmed) {
      setRollingBackSnapshot(snapshot.id);
      try {
        await rollbackSnapshot.mutateAsync({ vmId: vm.id, snapshotId: snapshot.id });
      } catch (error) {
        console.error('Failed to rollback:', error);
      } finally {
        setRollingBackSnapshot(null);
      }
    }
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const copySshCommand = async () => {
    if (!sshCommand) return;

    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(sshCommand);
      } else {
        // Fallback for non-secure contexts (HTTP)
        const textArea = document.createElement('textarea');
        textArea.value = sshCommand;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const downloadSshKey = async () => {
    try {
      const blob = await downloadVmSshKey();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'vm_id_ed25519';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setKeyDownloaded(true);
      setShowChmodHint(true);
      setTimeout(() => setKeyDownloaded(false), 2000);
    } catch (error) {
      console.error('Failed to download SSH key:', error);
    }
  };

  return (
    <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-4 hover:border-[hsl(var(--cyan)/0.3)] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColors[vm.status] || statusColors.stopped}`} />
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">{vm.name}</h3>
        </div>
        <span className="text-[10px] font-mono text-[hsl(var(--text-muted))] bg-[hsl(var(--bg-elevated))] px-1.5 py-0.5">
          {vm.status.toUpperCase()}
        </span>
      </div>

      {/* Resources */}
      <div className="flex gap-3 mb-3 text-[10px] text-[hsl(var(--text-muted))]">
        <div className="flex items-center gap-1">
          <Cpu className="h-3 w-3" />
          {vm.vcpus} vCPU
        </div>
        <div className="flex items-center gap-1">
          <MemoryStick className="h-3 w-3" />
          {vm.memoryMb} MB
        </div>
        <div className="flex items-center gap-1">
          <HardDrive className="h-3 w-3" />
          {vm.diskGb} GB
        </div>
      </div>

      {/* Image & Hypervisor */}
      <div className="flex items-center gap-3 text-[10px] text-[hsl(var(--text-muted))] mb-3">
        <span className="truncate" title={vm.image}>
          Image: {vm.image}
        </span>
        {vm.hypervisor && (
          <span className={`flex items-center gap-1 px-1.5 py-0.5 border ${
            vm.hypervisor === 'firecracker'
              ? 'text-[hsl(var(--purple))] border-[hsl(var(--purple)/0.3)] bg-[hsl(var(--purple)/0.1)]'
              : vm.hypervisor === 'daytona'
              ? 'text-[hsl(var(--amber))] border-[hsl(var(--amber)/0.3)] bg-[hsl(var(--amber)/0.1)]'
              : 'text-[hsl(var(--cyan))] border-[hsl(var(--cyan)/0.3)] bg-[hsl(var(--cyan)/0.1)]'
          }`}>
            {vm.hypervisor === 'firecracker' ? <Flame className="h-3 w-3" /> :
             vm.hypervisor === 'daytona' ? <Globe className="h-3 w-3" /> :
             <Cloud className="h-3 w-3" />}
            {vm.hypervisor === 'firecracker' ? 'FC' :
             vm.hypervisor === 'daytona' ? 'DT' : 'CH'}
          </span>
        )}
      </div>

      {/* Network Info */}
      {vm.guestIp && (
        <div className="text-[10px] text-[hsl(var(--text-muted))] mb-3 flex items-center gap-1">
          <Network className="h-3 w-3" />
          {vm.guestIp} ({vm.networkMode})
        </div>
      )}

      {/* Port Shortcuts */}
      {isRunning && vm.guestIp && (
        <div className="mb-3">
          {editingPorts ? (
            <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-muted))]">
                  <Globe className="h-3 w-3" />
                  <span>Port Shortcuts</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditPorts([...editPorts, { container: 8080, host: 8080 }])}
                    className="p-1 text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
                    title="Add port"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => {
                      updatePorts.mutate({ vmId: vm.id, ports: editPorts });
                      setEditingPorts(false);
                    }}
                    disabled={updatePorts.isPending}
                    className="p-1 text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)]"
                    title="Save"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => setEditingPorts(false)}
                    className="p-1 text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))]"
                    title="Cancel"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                {editPorts.map((port, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <label className="text-[10px] text-[hsl(var(--text-muted))]">Port:</label>
                    <input
                      type="number"
                      value={port.container}
                      onChange={e => {
                        const newPorts = [...editPorts];
                        newPorts[idx] = { ...port, container: Number(e.target.value), host: Number(e.target.value) };
                        setEditPorts(newPorts);
                      }}
                      className="w-20 px-2 py-1 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] text-[10px] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                      min={1}
                      max={65535}
                    />
                    <button
                      onClick={() => setEditPorts(editPorts.filter((_, i) => i !== idx))}
                      className="p-1 text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)]"
                      title="Remove"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {editPorts.length === 0 && (
                  <p className="text-[10px] text-[hsl(var(--text-muted))] italic">No shortcuts. Click + to add.</p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-muted))]">
                  <Globe className="h-3 w-3" />
                  <span>Port Shortcuts</span>
                </div>
                <button
                  onClick={() => {
                    setEditPorts(vm.ports || []);
                    setEditingPorts(true);
                  }}
                  className="p-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]"
                  title="Edit port shortcuts"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
              {vm.ports && vm.ports.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {vm.ports.map((port, idx) => (
                    <a
                      key={idx}
                      href={`http://${vm.guestIp}:${port.container}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] hover:bg-[hsl(var(--cyan)/0.2)] transition-colors group"
                      title={`Open http://${vm.guestIp}:${port.container}`}
                    >
                      <span>:{port.container}</span>
                      <ExternalLink className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100" />
                    </a>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-[hsl(var(--text-muted))] italic">No shortcuts configured</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {hasError && vm.error && (
        <div className="text-[10px] text-[hsl(var(--red))] mb-3 bg-[hsl(var(--red)/0.1)] p-2 border border-[hsl(var(--red)/0.3)]">
          {vm.error}
        </div>
      )}

      {/* SSH Command */}
      {isRunning && sshCommand && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))]">
              <Terminal className="h-3 w-3" />
              SSH Command
            </div>
            {isTapMode && (
              <div className="flex items-center gap-0.5 text-[10px]">
                <button
                  onClick={() => setConnectionMode('remote')}
                  className={`px-1.5 py-0.5 transition-colors ${
                    connectionMode === 'remote'
                      ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                      : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]'
                  }`}
                  title="Connect from external machine via jump host"
                >
                  Remote
                </button>
                <button
                  onClick={() => setConnectionMode('local')}
                  className={`px-1.5 py-0.5 transition-colors ${
                    connectionMode === 'local'
                      ? 'text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
                      : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]'
                  }`}
                  title="Connect from host machine directly"
                >
                  Local
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <code className="flex-1 text-[10px] bg-[hsl(var(--bg-base))] text-[hsl(var(--cyan))] px-2 py-1 font-mono truncate" title={sshCommand}>
              {sshCommand}
            </code>
            <button
              onClick={copySshCommand}
              className="p-1 hover:bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              title="Copy SSH command"
            >
              {copied ? <Check className="h-3 w-3 text-[hsl(var(--green))]" /> : <Copy className="h-3 w-3" />}
            </button>
          </div>
          {connectionMode === 'remote' && !hasJumpHost && (
            <p className="text-[9px] text-[hsl(var(--amber))] mt-1">
              Configure SSH Jump Host in Settings for remote access
            </p>
          )}
        </div>
      )}

      {/* Chmod Hint */}
      {showChmodHint && (
        <div className="mb-3 p-2 bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-[hsl(var(--amber))]">Fix key permissions:</span>
            <button
              onClick={() => setShowChmodHint(false)}
              className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            >
              ×
            </button>
          </div>
          <code className="text-[hsl(var(--text-secondary))] block mt-1">
            chmod 600 {config?.sshKeysDisplayPath || '~/.ssh'}/vm_id_ed25519
          </code>
        </div>
      )}

      {/* Snapshots Section */}
      <div className="mb-3">
        <button
          onClick={() => setShowSnapshots(!showSnapshots)}
          className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] mb-2"
        >
          {showSnapshots ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Camera className="h-3 w-3" />
          Snapshots ({snapshots?.length || 0})
        </button>

        {showSnapshots && (
          <div className="space-y-2 pl-4">
            {/* Create snapshot form */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={snapshotName}
                onChange={e => setSnapshotName(e.target.value)}
                placeholder="Snapshot name (optional)"
                className="flex-1 px-2 py-1 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[10px] text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              />
              <button
                onClick={handleCreateSnapshot}
                disabled={createSnapshot.isPending || !isRunning}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
                title={!isRunning ? 'VM must be running to create snapshot' : 'Create snapshot'}
              >
                {createSnapshot.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Camera className="h-3 w-3" />
                )}
                {createSnapshot.isPending ? 'Creating...' : 'Take'}
              </button>
            </div>

            {/* Snapshots list */}
            {snapshotsLoading ? (
              <div className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading...
              </div>
            ) : snapshots && snapshots.length > 0 ? (
              <div className="space-y-1">
                {snapshots.map(snapshot => (
                  <div
                    key={snapshot.id}
                    className="flex items-center justify-between p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[10px]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[hsl(var(--text-primary))] truncate">
                        {snapshot.name || snapshot.id}
                      </div>
                      <div className="text-[hsl(var(--text-muted))]">
                        {new Date(snapshot.createdAt).toLocaleString()} • {formatSize(snapshot.sizeBytes)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleRollbackToSnapshot(snapshot)}
                        disabled={rollingBackSnapshot === snapshot.id || launchingSnapshot === snapshot.id}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)] disabled:opacity-50"
                        title="Restore this VM to the snapshot state (stops VM and replaces disk)"
                      >
                        {rollingBackSnapshot === snapshot.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        <span>Rollback</span>
                      </button>
                      <button
                        onClick={() => handleLaunchFromSnapshot(snapshot)}
                        disabled={launchingSnapshot === snapshot.id || rollingBackSnapshot === snapshot.id}
                        className="flex items-center gap-1 px-1.5 py-0.5 text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
                        title="Create a new independent VM from this snapshot"
                      >
                        {launchingSnapshot === snapshot.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        <span>New VM</span>
                      </button>
                      <button
                        onClick={() => handleDeleteSnapshot(snapshot)}
                        disabled={deleteSnapshot.isPending || launchingSnapshot === snapshot.id || rollingBackSnapshot === snapshot.id}
                        className="p-1 text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] disabled:opacity-50"
                        title="Delete snapshot"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-[hsl(var(--text-muted))] italic">
                No snapshots yet. Take a snapshot while the VM is running.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-[hsl(var(--border))]">
        {isRunning || isBooting ? (
          <button
            onClick={handleStop}
            disabled={stopVm.isPending}
            className="flex items-center gap-1 px-2 py-1 text-[10px] border disabled:opacity-50 text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border-[hsl(var(--red)/0.3)]"
          >
            <Square className="h-3 w-3" />
            {isBooting ? 'Kill' : 'Stop'}
          </button>
        ) : (
          <button
            onClick={handleStart}
            disabled={startVm.isPending}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50"
          >
            <Play className="h-3 w-3" />
            Start
          </button>
        )}

        {/* Logs button - show during boot, when running, or on error */}
        {(isBooting || isRunning || hasError) && (
          <button
            onClick={() => setShowLogs(true)}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.3)]"
            title="View logs"
          >
            <ScrollText className="h-3 w-3" />
            Logs
          </button>
        )}

        {/* Terminal button - only show when running and has IP */}
        {isRunning && vm.guestIp && (
          <>
            <button
              onClick={() => terminalPanel.openTerminal(vm.id, vm.name, vm.guestIp!)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)]"
              title="Open terminal"
            >
              <TerminalSquare className="h-3 w-3" />
              Shell
            </button>
            <button
              onClick={() => setShowFiles(true)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
              title="Browse and upload files"
            >
              <FolderOpen className="h-3 w-3" />
              Files
            </button>
          </>
        )}

        <button
          onClick={downloadSshKey}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] border transition-colors ${
            keyDownloaded
              ? 'text-[hsl(var(--green))] border-[hsl(var(--green)/0.3)]'
              : 'text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.1)] border-[hsl(var(--purple)/0.3)]'
          }`}
          title="Download SSH key"
        >
          {keyDownloaded ? <Check className="h-3 w-3" /> : <Download className="h-3 w-3" />}
          {keyDownloaded ? 'Downloaded' : 'Key'}
        </button>

        <div className="flex-1" />

        <button
          onClick={handleDelete}
          disabled={deleteVm.isPending || isRunning}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] border ${
            isRunning
              ? 'text-[hsl(var(--text-muted))] border-[hsl(var(--border))] cursor-not-allowed opacity-50'
              : 'text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border-[hsl(var(--red)/0.3)]'
          }`}
          title={isRunning ? 'Stop VM before deleting' : 'Delete VM'}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      {/* Log Viewer */}
      {showLogs && (
        <LogViewer
          vmId={vm.id}
          title={vm.name}
          onClose={() => setShowLogs(false)}
        />
      )}

      {/* File Browser Modal */}
      {showFiles && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-4xl h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
              <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
                Files - {vm.name}
              </h3>
              <button
                onClick={() => setShowFiles(false)}
                className="text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <VMFileBrowser vmId={vm.id} vmName={vm.name} isRunning={isRunning} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface VolumeEntry {
  name: string;
  mountPath: string;
  readOnly: boolean;
}

interface PortEntry {
  container: number;
  host: number;
}

type VmSizePreset = 'small' | 'medium' | 'large';

const VM_SIZE_PRESETS: Record<VmSizePreset, { vcpus: number; memoryMb: number; diskGb: number; label: string }> = {
  small: { vcpus: 1, memoryMb: 1024, diskGb: 5, label: 'Small' },
  medium: { vcpus: 4, memoryMb: 4096, diskGb: 5, label: 'Medium' },
  large: { vcpus: 8, memoryMb: 8192, diskGb: 10, label: 'Large' },
};

function CreateVMForm({ onClose }: { onClose: () => void }) {
  const createVm = useCreateVm();
  const { data: baseImages } = useVmBaseImages();
  const { data: availableVolumes } = useVolumes();
  const [name, setName] = useState('');
  const [baseImage, setBaseImage] = useState('');
  const [vcpus, setVcpus] = useState(1);
  const [memoryMb, setMemoryMb] = useState(1024);
  const [diskGb, setDiskGb] = useState(5);
  const [volumes, setVolumes] = useState<VolumeEntry[]>([]);
  const [ports, setPorts] = useState<PortEntry[]>([
    { container: 3000, host: 3000 },
    { container: 5173, host: 5173 },
    { container: 8080, host: 8080 },
  ]);
  const [hypervisor, setHypervisor] = useState<HypervisorType | null>(null);
  const [backends, setBackends] = useState<BackendStatus | null>(null);
  const [daytonaSizeClass, setDaytonaSizeClass] = useState<DaytonaSizeClass>('small');

  // Detect which preset matches current values (if any)
  const activePreset = useMemo<VmSizePreset | null>(() => {
    for (const [key, config] of Object.entries(VM_SIZE_PRESETS)) {
      if (config.vcpus === vcpus && config.memoryMb === memoryMb && config.diskGb === diskGb) {
        return key as VmSizePreset;
      }
    }
    return null;
  }, [vcpus, memoryMb, diskGb]);

  // Apply size preset when clicked
  const applyPreset = (preset: VmSizePreset) => {
    const config = VM_SIZE_PRESETS[preset];
    setVcpus(config.vcpus);
    setMemoryMb(config.memoryMb);
    setDiskGb(config.diskGb);
  };

  const isLocalBackend = hypervisor !== 'daytona';

  // Determine available hypervisors based on backend status
  const availableHypervisors = useMemo<HypervisorType[]>(() => {
    const available: HypervisorType[] = [];
    if (backends?.cloudHypervisor?.installed && backends?.cloudHypervisor?.enabled) {
      available.push('cloud-hypervisor');
    }
    if (backends?.firecracker?.installed && backends?.firecracker?.enabled) {
      available.push('firecracker');
    }
    if (backends?.daytona?.installed && backends?.daytona?.enabled) {
      available.push('daytona');
    }
    return available;
  }, [backends]);

  // Fetch backend status on mount
  useEffect(() => {
    getBackendStatus().then(setBackends).catch(console.error);
  }, []);

  // Auto-select the first available hypervisor
  useEffect(() => {
    if (!hypervisor && availableHypervisors.length > 0) {
      // Prefer firecracker if available, otherwise first available
      if (availableHypervisors.includes('firecracker')) {
        setHypervisor('firecracker');
      } else {
        setHypervisor(availableHypervisors[0]);
      }
    }
  }, [availableHypervisors, hypervisor]);

  // Auto-select the first available base image
  useEffect(() => {
    if (baseImages && baseImages.length > 0 && !baseImage) {
      setBaseImage(baseImages[0].name);
    }
  }, [baseImages, baseImage]);

  const addVolume = () => {
    setVolumes([...volumes, { name: '', mountPath: '/mnt/data', readOnly: false }]);
  };

  const removeVolume = (index: number) => {
    setVolumes(volumes.filter((_, i) => i !== index));
  };

  const updateVolume = (index: number, field: keyof VolumeEntry, value: string | boolean) => {
    setVolumes(volumes.map((v, i) => i === index ? { ...v, [field]: value } : v));
  };

  const addPort = () => {
    setPorts([...ports, { container: 3000, host: 3000 }]);
  };

  const removePort = (index: number) => {
    setPorts(ports.filter((_, i) => i !== index));
  };

  const updatePort = (index: number, field: keyof PortEntry, value: number) => {
    setPorts(ports.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Convert volumes to the format expected by the API
      const volumeMounts = volumes
        .filter(v => v.name && v.mountPath)
        .map(v => {
          const vol = availableVolumes?.find(av => av.name === v.name);
          return {
            name: v.name,
            hostPath: vol?.mountpoint || `/var/lib/docker/volumes/${v.name}/_data`,
            mountPath: v.mountPath,
            readOnly: v.readOnly,
          };
        });

      // Filter valid ports (both container and host must be set)
      const validPorts = ports.filter(p => p.container > 0 && p.host > 0);

      await createVm.mutateAsync({
        name,
        baseImage: baseImage || undefined,
        vcpus,
        memoryMb,
        diskGb,
        volumes: volumeMounts.length > 0 ? volumeMounts : undefined,
        ports: validPorts.length > 0 ? validPorts : undefined,
        autoStart: true,
        hypervisor: hypervisor || 'cloud-hypervisor',
        daytonaSizeClass: hypervisor === 'daytona' ? daytonaSizeClass : undefined,
      });
      onClose();
    } catch (error) {
      console.error('Failed to create VM:', error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-full max-w-md mx-4 p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))] mb-4">Create Virtual Machine</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              placeholder="my-vm"
              required
              pattern="^[a-zA-Z0-9][a-zA-Z0-9_.-]*$"
            />
          </div>

          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Base Image</label>
            <select
              value={baseImage}
              onChange={e => setBaseImage(e.target.value)}
              className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              required
            >
              {baseImages && baseImages.length > 0 ? (
                baseImages.map(img => (
                  <option key={img.name} value={img.name}>
                    {img.name} {img.hasWarmupSnapshot ? '(fast boot)' : ''}
                  </option>
                ))
              ) : (
                <option value="" disabled>No base images available</option>
              )}
            </select>
          </div>

          {/* Hypervisor Selection */}
          <div>
            <label className="block text-xs text-[hsl(var(--text-muted))] mb-2">Backend</label>
            {availableHypervisors.length === 0 ? (
              <div className="p-3 text-xs text-[hsl(var(--amber))] bg-[hsl(var(--amber)/0.1)] border border-[hsl(var(--amber)/0.2)]">
                No backends available. Check Settings &rarr; Backends to configure.
              </div>
            ) : (
              <div className={`grid gap-2 ${availableHypervisors.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                {availableHypervisors.includes('cloud-hypervisor') && (
                  <button
                    type="button"
                    onClick={() => setHypervisor('cloud-hypervisor')}
                    className={`flex items-center gap-2 px-3 py-2 border transition-colors ${
                      hypervisor === 'cloud-hypervisor'
                        ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)] text-[hsl(var(--cyan))]'
                        : 'border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--cyan)/0.5)]'
                    }`}
                  >
                    <Cloud className="h-4 w-4" />
                    <span className="text-xs font-medium">Cloud-Hypervisor</span>
                  </button>
                )}
                {availableHypervisors.includes('firecracker') && (
                  <button
                    type="button"
                    onClick={() => setHypervisor('firecracker')}
                    className={`flex items-center gap-2 px-3 py-2 border transition-colors ${
                      hypervisor === 'firecracker'
                        ? 'border-[hsl(var(--purple))] bg-[hsl(var(--purple)/0.1)] text-[hsl(var(--purple))]'
                        : 'border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--purple)/0.5)]'
                    }`}
                  >
                    <Flame className="h-4 w-4" />
                    <span className="text-xs font-medium">Firecracker</span>
                  </button>
                )}
                {availableHypervisors.includes('daytona') && (
                  <button
                    type="button"
                    onClick={() => setHypervisor('daytona')}
                    className={`flex items-center gap-2 px-3 py-2 border transition-colors ${
                      hypervisor === 'daytona'
                        ? 'border-[hsl(var(--amber))] bg-[hsl(var(--amber)/0.1)] text-[hsl(var(--amber))]'
                        : 'border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--amber)/0.5)]'
                    }`}
                  >
                    <Globe className="h-4 w-4" />
                    <span className="text-xs font-medium">Daytona</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* VM Size - only for local backends */}
          {isLocalBackend && (
            <div>
              <label className="block text-xs text-[hsl(var(--text-muted))] mb-2">Size</label>
              <div className="grid grid-cols-3 gap-2">
                {(['small', 'medium', 'large'] as const).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyPreset(preset)}
                    className={`flex flex-col items-center px-3 py-2 border transition-colors ${
                      activePreset === preset
                        ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)] text-[hsl(var(--cyan))]'
                        : 'border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--cyan)/0.5)]'
                    }`}
                  >
                    <span className="text-xs font-medium">{VM_SIZE_PRESETS[preset].label}</span>
                    <span className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
                      {VM_SIZE_PRESETS[preset].vcpus} vCPU / {VM_SIZE_PRESETS[preset].memoryMb / 1024} GB
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Daytona Size Class - only for Daytona backend */}
          {hypervisor === 'daytona' && (
            <div>
              <label className="block text-xs text-[hsl(var(--text-muted))] mb-2">Sandbox Size</label>
              <div className="grid grid-cols-3 gap-2">
                {(['small', 'medium', 'large'] as const).map((sizeClass) => (
                  <button
                    key={sizeClass}
                    type="button"
                    onClick={() => setDaytonaSizeClass(sizeClass)}
                    className={`flex flex-col items-center px-3 py-2 border transition-colors ${
                      daytonaSizeClass === sizeClass
                        ? 'border-[hsl(var(--amber))] bg-[hsl(var(--amber)/0.1)] text-[hsl(var(--amber))]'
                        : 'border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:border-[hsl(var(--amber)/0.5)]'
                    }`}
                  >
                    <span className="text-xs font-medium">{DAYTONA_SIZE_PRESETS[sizeClass].label}</span>
                    <span className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
                      {DAYTONA_SIZE_PRESETS[sizeClass].cpu} vCPU / {DAYTONA_SIZE_PRESETS[sizeClass].memoryGb} GB
                    </span>
                    <span className="text-[10px] text-[hsl(var(--text-muted))]">
                      {DAYTONA_SIZE_PRESETS[sizeClass].diskGb} GB disk
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Resource inputs - always visible for local backends */}
          {isLocalBackend && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">vCPUs</label>
                <input
                  type="number"
                  value={vcpus}
                  onChange={e => setVcpus(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                  min={1}
                  max={32}
                />
              </div>
              <div>
                <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Memory (MB)</label>
                <input
                  type="number"
                  value={memoryMb}
                  onChange={e => setMemoryMb(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                  min={512}
                  max={65536}
                  step={256}
                />
              </div>
              <div>
                <label className="block text-xs text-[hsl(var(--text-muted))] mb-1">Disk (GB)</label>
                <input
                  type="number"
                  value={diskGb}
                  onChange={e => setDiskGb(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-sm text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                  min={1}
                  max={1000}
                />
              </div>
            </div>
          )}

          {/* Volumes Section - only for local backends */}
          {isLocalBackend && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--text-muted))]">
                <HardDrive className="h-3 w-3" />
                Shared Volumes (Optional)
              </label>
              <button
                type="button"
                onClick={addVolume}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            </div>

            {volumes.length === 0 ? (
              <p className="text-[10px] text-[hsl(var(--text-muted))]">
                VM has its own writable disk ({diskGb} GB). Add volumes to share data between VMs.
              </p>
            ) : (
              <div className="space-y-2">
                {volumes.map((vol, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
                    <select
                      value={vol.name}
                      onChange={e => updateVolume(index, 'name', e.target.value)}
                      className="flex-1 px-2 py-1 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] text-xs text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                    >
                      <option value="">Select volume...</option>
                      {availableVolumes?.map(v => (
                        <option key={v.name} value={v.name}>{v.name}</option>
                      ))}
                    </select>
                    <span className="text-[10px] text-[hsl(var(--text-muted))]">→</span>
                    <input
                      type="text"
                      value={vol.mountPath}
                      onChange={e => updateVolume(index, 'mountPath', e.target.value)}
                      className="flex-1 px-2 py-1 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] text-xs text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                      placeholder="/mnt/data"
                    />
                    <label className="flex items-center gap-1 text-[10px] text-[hsl(var(--text-muted))]">
                      <input
                        type="checkbox"
                        checked={vol.readOnly}
                        onChange={e => updateVolume(index, 'readOnly', e.target.checked)}
                        className="w-3 h-3"
                      />
                      RO
                    </label>
                    <button
                      type="button"
                      onClick={() => removeVolume(index)}
                      className="p-1 text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)]"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          )}

          {/* Port Shortcuts Section - only for local backends */}
          {isLocalBackend && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="flex items-center gap-1.5 text-xs text-[hsl(var(--text-muted))]">
                <Globe className="h-3 w-3" />
                Port Shortcuts
              </label>
              <button
                type="button"
                onClick={addPort}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            </div>

            {ports.length === 0 ? (
              <p className="text-[10px] text-[hsl(var(--text-muted))] italic">
                No shortcuts. Click "Add" to add a port shortcut.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {ports.map((port, index) => (
                  <div key={index} className="flex items-center gap-1 px-2 py-1 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
                    <span className="text-[10px] text-[hsl(var(--text-muted))]">:</span>
                    <input
                      type="number"
                      value={port.container}
                      onChange={e => {
                        const val = Number(e.target.value);
                        updatePort(index, 'container', val);
                        updatePort(index, 'host', val);
                      }}
                      className="w-16 px-1 py-0.5 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] text-xs text-[hsl(var(--text-primary))] focus:border-[hsl(var(--cyan))] focus:outline-none"
                      min={1}
                      max={65535}
                      placeholder="3000"
                    />
                    <button
                      type="button"
                      onClick={() => removePort(index)}
                      className="p-0.5 text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)]"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[9px] text-[hsl(var(--text-muted))] mt-1">
              Quick access links to services running in the VM
            </p>
          </div>
          )}

          <div className="flex gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createVm.isPending || !name || !hypervisor || availableHypervisors.length === 0}
              className="flex-1 px-4 py-2 text-sm text-[hsl(var(--cyan))] border border-[hsl(var(--cyan)/0.3)] hover:bg-[hsl(var(--cyan)/0.1)] disabled:opacity-50"
            >
              {createVm.isPending ? 'Creating...' : hypervisor === 'daytona' ? 'Create Workspace' : 'Create VM'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const VM_VIEW_MODE_KEY = 'handler-vm-view-mode';

export function VMList({ onCreateClick: _onCreateClick }: VMListProps) {
  const { data: vms, isLoading, error } = useVms();
  const { data: networkStatus } = useVmNetworkStatus();
  const { data: config } = useConfig();
  const { data: baseImages } = useVmBaseImages();
  const createVm = useCreateVm();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [hostCopied, setHostCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const stored = localStorage.getItem(VM_VIEW_MODE_KEY);
    if (stored === 'compact' || stored === 'detailed' || stored === 'list') {
      return stored;
    }
    return 'compact';
  });

  // Persist view mode to localStorage
  useEffect(() => {
    localStorage.setItem(VM_VIEW_MODE_KEY, viewMode);
  }, [viewMode]);

  // Find the warmed-up base image for quick launch
  const warmedUpImage = useMemo(() => {
    return baseImages?.find(img => img.hasWarmupSnapshot);
  }, [baseImages]);

  // Generate a unique VM name
  const generateVmName = () => {
    const existingNames = new Set(vms?.map(vm => vm.name) || []);
    let counter = 1;
    let name = `vm-${counter}`;
    while (existingNames.has(name)) {
      counter++;
      name = `vm-${counter}`;
    }
    return name;
  };

  // Quick launch handler
  const handleQuickLaunch = async () => {
    try {
      await createVm.mutateAsync({
        name: generateVmName(),
        baseImage: warmedUpImage?.name,
        vcpus: 1,
        memoryMb: 1024,
        diskGb: 5,
        autoStart: true,
      });
    } catch (error) {
      console.error('Failed to quick launch VM:', error);
    }
  };

  // Generate host connection command
  const hostSshCommand = useMemo(() => {
    if (!config?.sshJumpHost || !config?.sshJumpHostKeyPath) return null;
    return `ssh -o IdentitiesOnly=yes -i ${config.sshJumpHostKeyPath} ${config.sshJumpHost}`;
  }, [config]);

  const copyHostCommand = async () => {
    if (!hostSshCommand) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(hostSshCommand);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = hostSshCommand;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setHostCopied(true);
      setTimeout(() => setHostCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--text-muted))]">
        <Loader2 className="h-6 w-6 animate-spin mr-2" />
        Loading VMs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 text-[hsl(var(--red))]">
        <AlertTriangle className="h-5 w-5 mr-2" />
        Failed to load VMs: {String(error)}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden p-4">
      {/* Network Status Warning */}
      {networkStatus && !networkStatus.healthy && (
        <div className="mb-4 p-3 bg-[hsl(var(--yellow)/0.1)] border border-[hsl(var(--yellow)/0.3)] text-[hsl(var(--yellow))]">
          <div className="flex items-center gap-2 text-sm font-medium mb-1">
            <AlertTriangle className="h-4 w-4" />
            Network Not Configured
          </div>
          <p className="text-xs text-[hsl(var(--text-muted))]">
            {networkStatus.message}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-[hsl(var(--text-muted))]">
            {vms?.length || 0} VM{(vms?.length || 0) !== 1 ? 's' : ''}
          </span>
          {networkStatus?.healthy && (
            <span className="text-[10px] text-[hsl(var(--green))] bg-[hsl(var(--green)/0.1)] px-2 py-0.5 border border-[hsl(var(--green)/0.3)]">
              {networkStatus.availableTaps < 0
                ? 'Network ready'
                : `Network: ${networkStatus.availableTaps} TAPs available`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center border border-[hsl(var(--border))]">
            <button
              onClick={() => setViewMode('compact')}
              className={`p-1.5 ${viewMode === 'compact' ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))]' : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'}`}
              title="Compact view"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('detailed')}
              className={`p-1.5 border-l border-[hsl(var(--border))] ${viewMode === 'detailed' ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))]' : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'}`}
              title="Detailed view"
            >
              <Rows3 className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 border-l border-[hsl(var(--border))] ${viewMode === 'list' ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))]' : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'}`}
              title="List view"
            >
              <LayoutList className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* Quick Launch Button */}
          <button
            onClick={handleQuickLaunch}
            disabled={createVm.isPending || !warmedUpImage}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
            title={warmedUpImage ? `Quick launch with ${warmedUpImage.name} (1 vCPU, 1GB RAM)` : 'No warmed-up base image available'}
          >
            {createVm.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            Quick Launch
          </button>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3.5 w-3.5" />
            New VM
          </button>
        </div>
      </div>

      {/* Host Connection Command */}
      {hostSshCommand && (
        <div className="mb-4 p-3 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))]">
          <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-muted))] mb-2">
            <Server className="h-3 w-3" />
            Connect to Host
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[10px] bg-[hsl(var(--bg-base))] text-[hsl(var(--purple))] px-2 py-1.5 font-mono truncate" title={hostSshCommand}>
              {hostSshCommand}
            </code>
            <button
              onClick={copyHostCommand}
              className="p-1.5 hover:bg-[hsl(var(--bg-elevated))] text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] border border-[hsl(var(--border))]"
              title="Copy host SSH command"
            >
              {hostCopied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--green))]" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* VM Grid/List */}
      {vms && vms.length > 0 ? (
        viewMode === 'list' ? (
          <VMListView vms={vms} />
        ) : (
          <div className={`flex-1 overflow-auto grid gap-4 content-start ${
            viewMode === 'compact'
              ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
              : 'grid-cols-1 lg:grid-cols-2'
          }`}>
            {vms.map(vm => (
              viewMode === 'compact'
                ? <VMCardCompact key={vm.id} vm={vm} />
                : <VMCard key={vm.id} vm={vm} />
            ))}
          </div>
        )
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-[hsl(var(--text-muted))]">
          <Server className="h-12 w-12 mb-3 opacity-30" />
          <p className="text-sm mb-1">No virtual machines</p>
          <p className="text-xs mb-4">Create a VM to get started with cloud-hypervisor</p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3.5 w-3.5" />
            Create VM
          </button>
        </div>
      )}

      {/* Create VM Modal */}
      {showCreateForm && (
        <CreateVMForm onClose={() => setShowCreateForm(false)} />
      )}
    </div>
  );
}
