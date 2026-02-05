import { useState, useEffect, useRef } from 'react';
import { Plus, Settings as SettingsIcon, HardDrive, Package, StickyNote, Cpu, MemoryStick, Activity, Clock, Monitor, LayoutGrid, Boxes, Camera, FileCode, Image, Cog, Puzzle, ChevronDown, ChevronRight, Store, Github } from 'lucide-react';
import { useExchangeGitHubCode } from './hooks/useGitHub';
import { Settings } from './components/Settings';
import { MCPPage } from './components/MCPPage';
import { Notes } from './components/Notes';
import { SandboxList, CreateSandboxForm } from './components/sandbox';
import { UnifiedVolumeList } from './components/volume/UnifiedVolumeList';
import { VMSnapshots } from './components/VMSnapshots';
import { CommandCentre } from './components/CommandCentre';
import { DockerfileEditor } from './components/DockerfileEditor';
import { ImageManager } from './components/ImageManager';
import { AgentConfig } from './components/AgentConfig';
import { PluginMarketplace } from './components/PluginMarketplace';
import { Repos } from './components/Repos';
import { ConfirmProvider } from './components/ConfirmModal';
import { ThemeToggle } from './components/ThemeToggle';
import { ThemeProvider } from './hooks/useTheme';
import { TerminalPanelProvider, useTerminalPanel } from './components/TerminalPanel';
import { useHealth, useConfig, useHostStats, useBackendStatus, useQuickLaunchConfig, useCreateContainer, useCreateVm, useContainers, useVms } from './hooks/useContainers';

// All possible tabs
type Tab = 'agents' | 'repos' | 'sandboxes' | 'volumes' | 'dockerfiles' | 'images' | 'snapshots' | 'mcp' | 'notes' | 'agent-config' | 'plugins' | 'settings';

// Valid tabs for persistence
const VALID_TABS: Tab[] = ['agents', 'repos', 'sandboxes', 'snapshots', 'volumes', 'dockerfiles', 'images', 'mcp', 'notes', 'agent-config', 'plugins', 'settings'];

interface NavItemDef {
  id: Tab;
  label: string;
  icon: typeof Boxes;
}

interface NavGroup {
  id: string;
  label: string;
  icon: typeof Boxes;
  children: NavItemDef[];
}

type NavEntry = NavItemDef | NavGroup | 'separator' | 'spacer';

function isGroup(entry: NavEntry): entry is NavGroup {
  return typeof entry === 'object' && 'children' in entry;
}

function isItem(entry: NavEntry): entry is NavItemDef {
  return typeof entry === 'object' && 'id' in entry && !('children' in entry);
}

const navStructure: NavEntry[] = [
  { id: 'agents', label: 'Agents', icon: LayoutGrid },
  'separator',
  {
    id: 'resources',
    label: 'Resources',
    icon: Boxes,
    children: [
      { id: 'sandboxes', label: 'Sandboxes', icon: Boxes },
      { id: 'images', label: 'Images', icon: Image },
      { id: 'dockerfiles', label: 'Dockerfiles', icon: FileCode },
      { id: 'volumes', label: 'Volumes', icon: HardDrive },
      { id: 'snapshots', label: 'Snapshots', icon: Camera },
    ],
  },
  {
    id: 'extensions',
    label: 'Extensions',
    icon: Puzzle,
    children: [
      { id: 'repos', label: 'Repos', icon: Github },
      { id: 'mcp', label: 'MCP Servers', icon: Package },
      { id: 'plugins', label: 'Plugins', icon: Store },
    ],
  },
  { id: 'agent-config', label: 'Agent Config', icon: Cog },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  'spacer',
];

// Build a flat lookup of tab id -> label (including group children)
function getTabLabelMap(): Map<Tab, string> {
  const map = new Map<Tab, string>();
  for (const entry of navStructure) {
    if (isItem(entry)) map.set(entry.id, entry.label);
    else if (isGroup(entry)) {
      for (const child of entry.children) {
        map.set(child.id, child.label);
      }
    }
  }
  return map;
}

const tabLabelMap = getTabLabelMap();

// Content area that adjusts for terminal panel
function TerminalAwareContent({ activeTab, onCreateClick, highlightedSandboxId }: { activeTab: Tab; onCreateClick: () => void; highlightedSandboxId?: string | null }) {
  const { isOpen, position, size, isResizing } = useTerminalPanel();

  // Calculate style adjustments based on terminal panel
  const style: React.CSSProperties = {};
  if (isOpen) {
    if (position === 'bottom') {
      style.paddingBottom = size;
    } else {
      style.paddingRight = size;
    }
  }

  return (
    <div className={`flex-1 overflow-hidden ${!isResizing ? 'transition-[padding] duration-200 ease-out' : ''}`} style={style}>
      {activeTab === 'agents' && <CommandCentre />}
      {activeTab === 'repos' && <Repos />}
      {activeTab === 'sandboxes' && <SandboxList onCreateClick={onCreateClick} highlightedId={highlightedSandboxId} />}
      {activeTab === 'volumes' && <UnifiedVolumeList />}
      {activeTab === 'dockerfiles' && <DockerfileEditor />}
      {activeTab === 'images' && <ImageManager />}
      {activeTab === 'snapshots' && <VMSnapshots />}
      {activeTab === 'mcp' && <MCPPage />}
      {activeTab === 'notes' && <Notes />}
      {activeTab === 'agent-config' && <AgentConfig />}
      {activeTab === 'plugins' && <PluginMarketplace />}
      {activeTab === 'settings' && <Settings />}
    </div>
  );
}

function App() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createFormInitial, setCreateFormInitial] = useState<{ backend?: string; image?: string }>({});
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('caisson:activeTab');
    // Migrate old command-centre value
    if (saved === 'command-centre') {
      localStorage.setItem('caisson:activeTab', 'agents');
      return 'agents';
    }
    if (saved && VALID_TABS.includes(saved as Tab)) {
      return saved as Tab;
    }
    return 'sandboxes';
  });
  const [showHostTooltip, setShowHostTooltip] = useState(false);
  const [highlightedSandboxId, setHighlightedSandboxId] = useState<string | null>(null);
  const { data: health } = useHealth();
  const { data: config } = useConfig();
  const { data: hostStats } = useHostStats();
  const { data: backendStatus } = useBackendStatus();
  const { data: quickLaunchConfig } = useQuickLaunchConfig();
  const { data: containers } = useContainers();
  const { data: vms } = useVms();
  const createContainerMutation = useCreateContainer();
  const createVmMutation = useCreateVm();

  // Generate unique name based on prefix and existing sandboxes (containers + VMs)
  const generateUniqueName = (prefix: string): string => {
    const containerNames = containers?.map(c => c.name) || [];
    const vmNames = vms?.map(v => v.name) || [];
    const existingNames = new Set([...containerNames, ...vmNames]);
    let counter = 1;
    let name = `${prefix}-${counter}`;
    while (existingNames.has(name)) {
      counter++;
      name = `${prefix}-${counter}`;
    }
    return name;
  };

  // Handle quick launch - create sandbox with configured defaults
  const handleQuickLaunch = async () => {
    if (!quickLaunchConfig) {
      setShowCreateForm(true);
      return;
    }

    const name = generateUniqueName(quickLaunchConfig.namePrefix || 'sandbox');
    const ports = quickLaunchConfig.ports?.map(p => ({ container: p, host: p })) || [];

    try {
      if (quickLaunchConfig.backend === 'docker') {
        await createContainerMutation.mutateAsync({
          name,
          image: quickLaunchConfig.image,
          ports,
        });
      } else if (quickLaunchConfig.backend === 'firecracker' || quickLaunchConfig.backend === 'cloud-hypervisor') {
        await createVmMutation.mutateAsync({
          name,
          hypervisor: quickLaunchConfig.backend,
          baseImage: quickLaunchConfig.image || 'ubuntu-24.04',
          vcpus: quickLaunchConfig.vcpus || 2,
          memoryMb: quickLaunchConfig.memoryMb || 2048,
          diskGb: quickLaunchConfig.diskGb || 10,
          ports,
        });
      } else {
        // For cloud backends, fall back to form for now
        setShowCreateForm(true);
        return;
      }

      // Navigate to sandboxes and highlight the new one
      setActiveTab('sandboxes');
      setHighlightedSandboxId(name);
      setTimeout(() => setHighlightedSandboxId(null), 3000);
    } catch (error) {
      console.error('Quick launch failed:', error);
      // Fall back to form on error
      setShowCreateForm(true);
    }
  };

  // Collapsible groups state
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('caisson:expandedGroups');
      if (saved) return JSON.parse(saved);
    } catch {}
    return { extensions: true, resources: true };
  });

  // Persist active tab
  useEffect(() => {
    localStorage.setItem('caisson:activeTab', activeTab);
  }, [activeTab]);

  // Persist expanded groups
  useEffect(() => {
    localStorage.setItem('caisson:expandedGroups', JSON.stringify(expandedGroups));
  }, [expandedGroups]);

  // Listen for tab change requests from other components (e.g., volume list -> sandboxes)
  useEffect(() => {
    const handleTabChange = (e: CustomEvent<{ tab: Tab }>) => {
      if (VALID_TABS.includes(e.detail.tab)) {
        setActiveTab(e.detail.tab);
      }
    };
    window.addEventListener('caisson-navigate-tab', handleTabChange as EventListener);
    return () => {
      window.removeEventListener('caisson-navigate-tab', handleTabChange as EventListener);
    };
  }, []);

  // Listen for create sandbox requests with initial values (e.g., from base images)
  useEffect(() => {
    const handleCreateSandbox = (e: CustomEvent<{ backend?: string; image?: string }>) => {
      setCreateFormInitial(e.detail || {});
      setShowCreateForm(true);
    };
    window.addEventListener('caisson-create-sandbox', handleCreateSandbox as EventListener);
    return () => {
      window.removeEventListener('caisson-create-sandbox', handleCreateSandbox as EventListener);
    };
  }, []);

  // Listen for direct launch requests (from Image Launch buttons)
  useEffect(() => {
    const handleLaunchSandbox = async (e: CustomEvent<{ backend: string; image: string; name?: string }>) => {
      const { backend, image, name: providedName } = e.detail;
      const name = providedName || generateUniqueName('sandbox');
      const ports = [{ container: 3000, host: 3000 }, { container: 5173, host: 5173 }];

      try {
        if (backend === 'docker') {
          await createContainerMutation.mutateAsync({ name, image, ports });
        } else if (backend === 'firecracker' || backend === 'cloud-hypervisor') {
          await createVmMutation.mutateAsync({
            name,
            hypervisor: backend,
            baseImage: image,
            vcpus: 2,
            memoryMb: 2048,
            diskGb: 10,
            ports,
          });
        }

        // Navigate to sandboxes and highlight the new one
        setActiveTab('sandboxes');
        setHighlightedSandboxId(name);
        setTimeout(() => setHighlightedSandboxId(null), 3000);
      } catch (error) {
        console.error('Launch failed:', error);
        // Fall back to form on error
        setCreateFormInitial({ backend, image });
        setShowCreateForm(true);
      }
    };
    window.addEventListener('caisson-launch-sandbox', handleLaunchSandbox as unknown as EventListener);
    return () => {
      window.removeEventListener('caisson-launch-sandbox', handleLaunchSandbox as unknown as EventListener);
    };
  }, [containers, vms, createContainerMutation, createVmMutation]);

  // GitHub OAuth callback handling
  const exchangeGitHubCode = useExchangeGitHubCode();
  const oauthHandledRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    // Check if this is a GitHub OAuth callback
    if (code && !oauthHandledRef.current) {
      oauthHandledRef.current = true;

      // Get the redirect URI (current URL without query params)
      const redirectUri = `${window.location.origin}${window.location.pathname}`;

      // Exchange the code for an access token
      exchangeGitHubCode.mutate(
        { code, redirectUri },
        {
          onSuccess: () => {
            // Clear the URL params and navigate to settings
            window.history.replaceState({}, '', window.location.pathname);
            setActiveTab('settings');
          },
          onError: (err) => {
            console.error('GitHub OAuth failed:', err);
            window.history.replaceState({}, '', window.location.pathname);
          },
        }
      );
    }
  }, []);

  const dockerConnected = health?.docker === 'connected';

  // Get enabled backends with their status
  const enabledBackends = backendStatus ? [
    { name: 'Docker', status: backendStatus.docker },
    { name: 'Cloud-Hypervisor', status: backendStatus.cloudHypervisor },
    { name: 'Firecracker', status: backendStatus.firecracker },
    { name: 'Daytona', status: backendStatus.daytona },
  ].filter(b => b.status.installed || b.status.enabled) : [];

  // Format bytes to human readable
  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(0)}G`;
  };

  // Format bytes with more precision for tooltip
  const formatBytesLong = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb < 10) return `${gb.toFixed(2)} GB`;
    if (gb < 100) return `${gb.toFixed(1)} GB`;
    return `${gb.toFixed(0)} GB`;
  };

  // Format uptime
  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const handleTabClick = (tab: Tab) => {
    setActiveTab(tab);
  };

  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // Check if a group contains the active tab
  const groupContainsActive = (group: NavGroup) =>
    group.children.some(c => c.id === activeTab);

  // Get the label for the current tab
  const getTabLabel = (): string => {
    return tabLabelMap.get(activeTab) || '';
  };

  const renderNavButton = (item: NavItemDef, indent = false) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <button
        key={item.id}
        onClick={() => handleTabClick(item.id)}
        className={`w-full flex items-center gap-2.5 ${indent ? 'pl-7 pr-3' : 'px-3'} py-2 mb-0.5 text-xs font-medium transition-all ${
          isActive
            ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] border-l-2 border-[hsl(var(--cyan))]'
            : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border-l-2 border-transparent'
        }`}
      >
        <Icon className="h-4 w-4" />
        {item.label}
      </button>
    );
  };

  return (
    <ThemeProvider>
    <ConfirmProvider>
    <TerminalPanelProvider>
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-52 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-[hsl(var(--border))]">
          <div className="relative">
            <img src="/logo.png" alt="Caisson" className="h-7 w-7" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-[hsl(var(--green))] animate-pulse-glow" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-[hsl(var(--text-primary))] tracking-tight">
              Caisson
            </h1>
            <p className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
              Control Panel
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto flex flex-col">
          {navStructure.map((entry, idx) => {
            if (entry === 'separator') {
              return <div key={`sep-${idx}`} className="my-1.5 mx-3 border-t border-[hsl(var(--border))]" />;
            }
            if (entry === 'spacer') {
              return <div key={`spacer-${idx}`} className="flex-1" />;
            }
            if (isGroup(entry)) {
              const expanded = expandedGroups[entry.id] ?? true;
              const GroupIcon = entry.icon;
              const containsActive = groupContainsActive(entry);
              return (
                <div key={entry.id} className="mb-0.5">
                  <button
                    onClick={() => toggleGroup(entry.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium transition-all border-l-2 border-transparent ${
                      containsActive && !expanded
                        ? 'text-[hsl(var(--cyan))]'
                        : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))]'
                    }`}
                  >
                    <GroupIcon className="h-4 w-4" />
                    <span className="flex-1 text-left">{entry.label}</span>
                    {expanded
                      ? <ChevronDown className="h-3 w-3 text-[hsl(var(--text-muted))]" />
                      : <ChevronRight className="h-3 w-3 text-[hsl(var(--text-muted))]" />
                    }
                  </button>
                  {expanded && entry.children.map(child => renderNavButton(child, true))}
                </div>
              );
            }
            // NavItemDef
            return renderNavButton(entry);
          })}
        </nav>

        {/* Host Info Panel */}
        {hostStats && (
          <div
            className="relative px-3 py-2.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))] cursor-pointer hover:bg-[hsl(var(--bg-elevated))] transition-colors"
            onMouseEnter={() => setShowHostTooltip(true)}
            onMouseLeave={() => setShowHostTooltip(false)}
          >
            <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider mb-2">
              <Activity className="h-3 w-3" />
              Host
            </div>
            <div className="space-y-1.5">
              {/* CPU */}
              <div className="flex items-center gap-2">
                <Cpu className="h-3 w-3 text-[hsl(var(--text-muted))]" />
                <div className="flex-1">
                  <div className="h-1.5 bg-[hsl(var(--bg-elevated))] overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        hostStats.cpu.usage > 80 ? 'bg-[hsl(var(--red))]' : hostStats.cpu.usage > 50 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--cyan))]'
                      }`}
                      style={{ width: `${hostStats.cpu.usage}%` }}
                    />
                  </div>
                </div>
                <span className="text-[10px] text-[hsl(var(--text-secondary))] w-8 text-right">{hostStats.cpu.usage}%</span>
              </div>
              {/* Memory */}
              <div className="flex items-center gap-2">
                <MemoryStick className="h-3 w-3 text-[hsl(var(--text-muted))]" />
                <div className="flex-1">
                  <div className="h-1.5 bg-[hsl(var(--bg-elevated))] overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        hostStats.memory.usage > 80 ? 'bg-[hsl(var(--red))]' : hostStats.memory.usage > 50 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--green))]'
                      }`}
                      style={{ width: `${hostStats.memory.usage}%` }}
                    />
                  </div>
                </div>
                <span className="text-[10px] text-[hsl(var(--text-secondary))] w-8 text-right">{formatBytes(hostStats.memory.used)}</span>
              </div>
              {/* Disk */}
              <div className="flex items-center gap-2">
                <HardDrive className="h-3 w-3 text-[hsl(var(--text-muted))]" />
                <div className="flex-1">
                  <div className="h-1.5 bg-[hsl(var(--bg-elevated))] overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        hostStats.disk.usage > 90 ? 'bg-[hsl(var(--red))]' : hostStats.disk.usage > 70 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--purple))]'
                      }`}
                      style={{ width: `${hostStats.disk.usage}%` }}
                    />
                  </div>
                </div>
                <span className="text-[10px] text-[hsl(var(--text-secondary))] w-8 text-right">{hostStats.disk.usage}%</span>
              </div>
            </div>

            {/* Tooltip */}
            {showHostTooltip && (
              <div className="absolute left-full bottom-0 ml-2 z-50 w-72 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-xl animate-in fade-in slide-in-from-left-2 duration-200">
                {/* Header */}
                <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))]">
                  <div className="flex items-center gap-2">
                    <Monitor className="h-4 w-4 text-[hsl(var(--cyan))]" />
                    <span className="text-sm font-medium text-[hsl(var(--text-primary))]">{hostStats.hostname}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1 text-[10px] text-[hsl(var(--text-muted))]">
                    <Clock className="h-3 w-3" />
                    Uptime: {formatUptime(hostStats.uptime)}
                  </div>
                </div>

                {/* Stats */}
                <div className="p-4 space-y-4">
                  {/* CPU Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-[hsl(var(--cyan))]" />
                        <span className="text-xs font-medium text-[hsl(var(--text-primary))]">CPU</span>
                      </div>
                      <span className={`text-xs font-mono ${
                        hostStats.cpu.usage > 80 ? 'text-[hsl(var(--red))]' : hostStats.cpu.usage > 50 ? 'text-[hsl(var(--amber))]' : 'text-[hsl(var(--cyan))]'
                      }`}>{hostStats.cpu.usage}%</span>
                    </div>
                    <div className="h-2 bg-[hsl(var(--bg-base))] overflow-hidden mb-2">
                      <div
                        className={`h-full transition-all ${
                          hostStats.cpu.usage > 80 ? 'bg-[hsl(var(--red))]' : hostStats.cpu.usage > 50 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--cyan))]'
                        }`}
                        style={{ width: `${hostStats.cpu.usage}%` }}
                      />
                    </div>
                    <div className="text-[10px] text-[hsl(var(--text-muted))] truncate" title={hostStats.cpu.model}>
                      {hostStats.cpu.cores} cores &bull; {hostStats.cpu.model.split('@')[0].trim()}
                    </div>
                  </div>

                  {/* Memory Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <MemoryStick className="h-4 w-4 text-[hsl(var(--green))]" />
                        <span className="text-xs font-medium text-[hsl(var(--text-primary))]">Memory</span>
                      </div>
                      <span className={`text-xs font-mono ${
                        hostStats.memory.usage > 80 ? 'text-[hsl(var(--red))]' : hostStats.memory.usage > 50 ? 'text-[hsl(var(--amber))]' : 'text-[hsl(var(--green))]'
                      }`}>{hostStats.memory.usage}%</span>
                    </div>
                    <div className="h-2 bg-[hsl(var(--bg-base))] overflow-hidden mb-2">
                      <div
                        className={`h-full transition-all ${
                          hostStats.memory.usage > 80 ? 'bg-[hsl(var(--red))]' : hostStats.memory.usage > 50 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--green))]'
                        }`}
                        style={{ width: `${hostStats.memory.usage}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-[hsl(var(--text-muted))]">
                      <span>Used: {formatBytesLong(hostStats.memory.used)}</span>
                      <span>Total: {formatBytesLong(hostStats.memory.total)}</span>
                    </div>
                  </div>

                  {/* Disk Section */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4 text-[hsl(var(--purple))]" />
                        <span className="text-xs font-medium text-[hsl(var(--text-primary))]">Disk</span>
                      </div>
                      <span className={`text-xs font-mono ${
                        hostStats.disk.usage > 90 ? 'text-[hsl(var(--red))]' : hostStats.disk.usage > 70 ? 'text-[hsl(var(--amber))]' : 'text-[hsl(var(--purple))]'
                      }`}>{hostStats.disk.usage}%</span>
                    </div>
                    <div className="h-2 bg-[hsl(var(--bg-base))] overflow-hidden mb-2">
                      <div
                        className={`h-full transition-all ${
                          hostStats.disk.usage > 90 ? 'bg-[hsl(var(--red))]' : hostStats.disk.usage > 70 ? 'bg-[hsl(var(--amber))]' : 'bg-[hsl(var(--purple))]'
                        }`}
                        style={{ width: `${hostStats.disk.usage}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-[hsl(var(--text-muted))]">
                      <span>Used: {formatBytesLong(hostStats.disk.used)}</span>
                      <span>Free: {formatBytesLong(hostStats.disk.free)}</span>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-4 py-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
                  <div className="text-[10px] text-[hsl(var(--text-muted))] text-center">
                    Auto-refreshes every 3 seconds
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bottom Actions */}
        <div className="p-3 border-t border-[hsl(var(--border))]">
          <button
            onClick={handleQuickLaunch}
            disabled={createContainerMutation.isPending || createVmMutation.isPending}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
              quickLaunchConfig
                ? 'text-[hsl(var(--green))] hover:bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.3)]'
                : 'text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]'
            }`}
            title={quickLaunchConfig ? `Quick launch: ${quickLaunchConfig.backend} (${quickLaunchConfig.namePrefix || 'sandbox'})` : 'Open sandbox creation form'}
          >
            <Plus className="h-3.5 w-3.5" />
            New Sandbox
            {quickLaunchConfig && <span className="text-[10px] opacity-70">({quickLaunchConfig.backend})</span>}
          </button>
        </div>

        {/* Status Bar */}
        <div className="px-3 py-2.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          <div className="flex flex-col gap-1 text-[10px]">
            {enabledBackends.map(({ name, status }) => {
              const isOnline = status.running || (status.enabled && !status.error);
              const isError = status.enabled && !status.running && status.error;
              return (
                <div key={name} className="flex items-center gap-1.5" title={status.error || (status.version ? `v${status.version}` : undefined)}>
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    isOnline ? 'bg-[hsl(var(--green))]' :
                    isError ? 'bg-[hsl(var(--red))]' :
                    'bg-[hsl(var(--text-muted))]'
                  }`} />
                  <span className={
                    isOnline ? 'text-[hsl(var(--green))]' :
                    isError ? 'text-[hsl(var(--red))]' :
                    'text-[hsl(var(--text-muted))]'
                  }>
                    {name}
                  </span>
                </div>
              );
            })}
            {enabledBackends.length === 0 && (
              <div className="flex items-center gap-1.5">
                <div className={`w-1.5 h-1.5 rounded-full ${dockerConnected ? 'bg-[hsl(var(--green))]' : 'bg-[hsl(var(--red))]'}`} />
                <span className={dockerConnected ? 'text-[hsl(var(--green))]' : 'text-[hsl(var(--red))]'}>
                  Docker {dockerConnected ? 'Online' : 'Offline'}
                </span>
              </div>
            )}
          </div>
          {config?.dataDirectory && (
            <div className="mt-1.5 text-[10px] text-[hsl(var(--text-muted))] cursor-help" title={config.dataDirectory}>
              Data Path (hover to view)
            </div>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[hsl(var(--bg-base))]">
        {/* Content Header */}
        <header className="flex items-center justify-between px-5 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <h2 className="text-sm font-semibold text-[hsl(var(--text-primary))] uppercase tracking-wider">
            {getTabLabel()}
          </h2>
          <div className="flex items-center gap-4">
            <div className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
            <ThemeToggle />
          </div>
        </header>

        {/* Content Area - uses TerminalAwareContent to adjust for terminal panel */}
        <TerminalAwareContent activeTab={activeTab} onCreateClick={() => setShowCreateForm(true)} highlightedSandboxId={highlightedSandboxId} />
      </main>

      {/* Modals */}
      {showCreateForm && (
        <CreateSandboxForm
          onClose={() => {
            setShowCreateForm(false);
            setCreateFormInitial({});
          }}
          initialBackend={createFormInitial.backend as any}
          initialImage={createFormInitial.image}
        />
      )}
    </div>
    </TerminalPanelProvider>
    </ConfirmProvider>
    </ThemeProvider>
  );
}

export default App;
