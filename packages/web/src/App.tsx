import { useState, useEffect } from 'react';
import { Plus, Settings as SettingsIcon, FileCode, Layers, HardDrive, Image, Package, StickyNote, ChevronDown, ChevronRight, Cpu, MemoryStick, Activity, Clock, Monitor, LayoutGrid, Boxes } from 'lucide-react';
// VolumeManager replaced by UnifiedVolumeList
import { DockerfileEditor } from './components/DockerfileEditor';
import { ImageList } from './components/ImageList';
import { Settings } from './components/Settings';
import { ComposeManager } from './components/ComposeManager';
import { MCPRegistry } from './components/MCPRegistry';
import { Notes } from './components/Notes';
import { SandboxList, CreateSandboxForm } from './components/sandbox';
import { UnifiedVolumeList } from './components/volume/UnifiedVolumeList';
import { CommandCentre } from './components/CommandCentre';
import { ConfirmProvider } from './components/ConfirmModal';
import { ThemeToggle } from './components/ThemeToggle';
import { ThemeProvider } from './hooks/useTheme';
import { TerminalPanelProvider } from './components/TerminalPanel';
import { useHealth, useConfig, useHostStats, useBackendStatus } from './hooks/useContainers';

// All possible tabs - simplified to unified abstractions
type Tab = 'command-centre' | 'sandboxes' | 'volumes' | 'images' | 'dockerfiles' | 'compose' | 'mcp' | 'notes' | 'settings';

// Navigation group identifiers
type NavGroupId = 'advanced';

interface NavItem {
  id: Tab;
  label: string;
  icon: typeof Boxes;
}

interface NavGroup {
  id: NavGroupId;
  label: string;
  icon: typeof Boxes;
  items: NavItem[];
}

interface StandaloneNavItem extends NavItem {
  standalone: true;
}

type NavConfigItem = NavGroup | StandaloneNavItem;

// Valid tabs for persistence
const VALID_TABS: Tab[] = ['command-centre', 'sandboxes', 'volumes', 'images', 'dockerfiles', 'compose', 'mcp', 'notes', 'settings'];

function App() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('caisson:activeTab');
    if (saved && VALID_TABS.includes(saved as Tab)) {
      return saved as Tab;
    }
    return 'sandboxes';
  });
  const [expandedGroups, setExpandedGroups] = useState<Set<NavGroupId>>(new Set(['advanced']));
  const [showHostTooltip, setShowHostTooltip] = useState(false);
  const { data: health } = useHealth();
  const { data: config } = useConfig();
  const { data: hostStats } = useHostStats();
  const { data: backendStatus } = useBackendStatus();

  // Persist active tab
  useEffect(() => {
    localStorage.setItem('caisson:activeTab', activeTab);
  }, [activeTab]);

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

  const navConfig: NavConfigItem[] = [
    { id: 'command-centre', label: 'Command Centre', icon: LayoutGrid, standalone: true },
    { id: 'sandboxes', label: 'Sandboxes', icon: Boxes, standalone: true },
    { id: 'volumes', label: 'Volumes', icon: HardDrive, standalone: true },
    { id: 'images', label: 'Images', icon: Image, standalone: true },
    {
      id: 'advanced',
      label: 'Advanced',
      icon: Layers,
      items: [
        { id: 'dockerfiles', label: 'Dockerfiles', icon: FileCode },
        { id: 'compose', label: 'Compose', icon: Layers },
      ],
    },
    { id: 'mcp', label: 'MCP Servers', icon: Package, standalone: true },
    { id: 'notes', label: 'Notes', icon: StickyNote, standalone: true },
    { id: 'settings', label: 'Settings', icon: SettingsIcon, standalone: true },
  ];

  const toggleGroup = (groupId: NavGroupId) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleTabClick = (tab: Tab, parentGroup?: NavGroupId) => {
    setActiveTab(tab);
    // Ensure parent group is expanded when clicking a sub-item
    if (parentGroup && !expandedGroups.has(parentGroup)) {
      setExpandedGroups(prev => new Set([...prev, parentGroup]));
    }
  };

  // Get the label for the current tab
  const getTabLabel = (): string => {
    for (const item of navConfig) {
      if ('standalone' in item && item.id === activeTab) {
        return item.label;
      }
      if ('items' in item) {
        const subItem = item.items.find(sub => sub.id === activeTab);
        if (subItem) return subItem.label;
      }
    }
    return '';
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
        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {navConfig.map((item) => {
            // Standalone item
            if ('standalone' in item) {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleTabClick(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 mb-0.5 text-xs font-medium transition-all ${
                    isActive
                      ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] border-l-2 border-[hsl(var(--cyan))]'
                      : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border-l-2 border-transparent'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            }

            // Collapsible group
            const GroupIcon = item.icon;
            const isExpanded = expandedGroups.has(item.id);
            const hasActiveChild = item.items.some(sub => sub.id === activeTab);

            return (
              <div key={item.id} className="mb-1">
                <button
                  onClick={() => toggleGroup(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium transition-all ${
                    hasActiveChild
                      ? 'text-[hsl(var(--cyan))]'
                      : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))]'
                  } hover:bg-[hsl(var(--bg-elevated))]`}
                >
                  <span className="flex items-center gap-2.5">
                    <GroupIcon className="h-4 w-4" />
                    {item.label}
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-[hsl(var(--text-muted))]" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-[hsl(var(--text-muted))]" />
                  )}
                </button>

                {isExpanded && (
                  <div className="ml-3 mt-0.5">
                    {item.items.map(subItem => {
                      const SubIcon = subItem.icon;
                      const isActive = activeTab === subItem.id;
                      return (
                        <button
                          key={subItem.id}
                          onClick={() => handleTabClick(subItem.id, item.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-1.5 mb-0.5 text-xs font-medium transition-all ${
                            isActive
                              ? 'bg-[hsl(var(--cyan)/0.15)] text-[hsl(var(--cyan))] border-l-2 border-[hsl(var(--cyan))]'
                              : 'text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border-l-2 border-transparent'
                          }`}
                        >
                          <SubIcon className="h-3.5 w-3.5" />
                          {subItem.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
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
            onClick={() => setShowCreateForm(true)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Sandbox
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

        {/* Content Area */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'command-centre' && <CommandCentre />}
          {activeTab === 'sandboxes' && <SandboxList onCreateClick={() => setShowCreateForm(true)} />}
          {activeTab === 'volumes' && <UnifiedVolumeList />}
          {activeTab === 'images' && <ImageList />}
          {activeTab === 'compose' && <ComposeManager />}
          {activeTab === 'dockerfiles' && <DockerfileEditor />}
          {activeTab === 'mcp' && <MCPRegistry />}
          {activeTab === 'notes' && <Notes />}
          {activeTab === 'settings' && <Settings />}
        </div>
      </main>

      {/* Modals */}
      {showCreateForm && (
        <CreateSandboxForm onClose={() => setShowCreateForm(false)} />
      )}
    </div>
    </TerminalPanelProvider>
    </ConfirmProvider>
    </ThemeProvider>
  );
}

export default App;
