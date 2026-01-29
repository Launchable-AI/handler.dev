import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Search,
  Loader2,
  Package,
  ExternalLink,
  Tag,
  Grid3X3,
  List,
  Store,
  Filter,
  Info,
  RefreshCw,
  FolderOpen,
  X,
  BookOpen,
  GripVertical,
  Plus,
  AlertCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { getPluginMarketplaces, searchPlugins, addPluginMarketplace, removePluginMarketplace } from '../api/client';
import type { MarketplaceData, MarketplacePlugin } from '../api/client';

type ViewLayout = 'grid' | 'list';
type DetailTab = 'info' | 'readme';

const PANEL_WIDTH_KEY = 'caisson-plugin-panel-width';
const MIN_PANEL_WIDTH = 300;
const MAX_PANEL_WIDTH = 800;
const DEFAULT_PANEL_WIDTH = 420;

// Extended plugin type that includes marketplace owner/repo for README fetching
interface PluginWithMeta extends MarketplacePlugin {
  _owner?: string;
  _repo?: string;
}

export function PluginMarketplace() {
  const [marketplaces, setMarketplaces] = useState<MarketplaceData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MarketplacePlugin[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedMarketplace, setSelectedMarketplace] = useState<string | null>(null);
  const [layout, setLayout] = useState<ViewLayout>('grid');

  // Detail panel state
  const [selectedPlugin, setSelectedPlugin] = useState<PluginWithMeta | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('info');
  const [readme, setReadme] = useState<string | null>(null);
  const [isLoadingReadme, setIsLoadingReadme] = useState(false);
  const [readmeError, setReadmeError] = useState<string | null>(null);

  // Resizable panel
  const [panelWidth, setPanelWidth] = useState(() => {
    const stored = localStorage.getItem(PANEL_WIDTH_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_PANEL_WIDTH && parsed <= MAX_PANEL_WIDTH) return parsed;
    }
    return DEFAULT_PANEL_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<HTMLDivElement>(null);

  // Add marketplace form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addFormInput, setAddFormInput] = useState('');
  const [addFormBranch, setAddFormBranch] = useState('');
  const [addFormPath, setAddFormPath] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
  }, [panelWidth]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const containerRect = resizeRef.current.parentElement?.getBoundingClientRect();
      if (!containerRect) return;
      const newWidth = containerRect.right - e.clientX;
      setPanelWidth(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, newWidth)));
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Build a slug -> {owner, repo} map from marketplaces
  const marketplaceMetaMap = useMemo(() => {
    const map = new Map<string, { owner: string; repo: string }>();
    for (const m of marketplaces) {
      if (m.owner && m.repo) {
        map.set(m.slug, { owner: m.owner, repo: m.repo });
      }
    }
    return map;
  }, [marketplaces]);

  // Fetch marketplaces on mount
  useEffect(() => {
    loadMarketplaces();
  }, []);

  const loadMarketplaces = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getPluginMarketplaces();
      setMarketplaces(res.marketplaces);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketplaces');
    } finally {
      setIsLoading(false);
    }
  };

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Execute search
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults(null);
      return;
    }
    let cancelled = false;
    const doSearch = async () => {
      setIsSearching(true);
      try {
        const res = await searchPlugins(debouncedQuery);
        if (!cancelled) setSearchResults(res.plugins);
      } catch {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    };
    doSearch();
    return () => { cancelled = true; };
  }, [debouncedQuery]);

  // Derive all plugins
  const allPlugins = useMemo(() => {
    if (searchResults !== null) return searchResults;
    return marketplaces.flatMap(m =>
      m.plugins.map(p => ({ ...p, marketplace: p.marketplace || m.slug }))
    );
  }, [marketplaces, searchResults]);

  // Categories with counts
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    allPlugins.forEach(p => {
      const cat = p.category || 'Uncategorized';
      map.set(cat, (map.get(cat) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [allPlugins]);

  // Filtered plugins
  const filteredPlugins = useMemo(() => {
    let list = allPlugins;
    if (selectedCategory) {
      list = list.filter(p => (p.category || 'Uncategorized') === selectedCategory);
    }
    if (selectedMarketplace) {
      list = list.filter(p => p.marketplace === selectedMarketplace);
    }
    return list;
  }, [allPlugins, selectedCategory, selectedMarketplace]);

  const totalCount = allPlugins.length;

  // Select a plugin for detail view
  const selectPlugin = (plugin: MarketplacePlugin) => {
    // Resolve owner/repo: from search results or from marketplace meta
    const owner = plugin.marketplaceOwner || (plugin.marketplace ? marketplaceMetaMap.get(plugin.marketplace)?.owner : undefined);
    const repo = plugin.marketplaceRepo || (plugin.marketplace ? marketplaceMetaMap.get(plugin.marketplace)?.repo : undefined);
    const pluginWithMeta: PluginWithMeta = { ...plugin, _owner: owner, _repo: repo };
    setSelectedPlugin(pluginWithMeta);
    setDetailTab('info');
    setReadme(null);
    setReadmeError(null);
  };

  // Load README from GitHub
  const loadReadme = async (plugin: PluginWithMeta) => {
    const { _owner: owner, _repo: repo, source } = plugin;
    if (!owner || !repo) {
      setReadmeError('Cannot determine repository for this plugin');
      return;
    }

    setIsLoadingReadme(true);
    setReadmeError(null);

    // Try to construct the README URL from source path
    const basePath = source?.path ? source.path.replace(/\/?$/, '') : '';
    const readmePaths = basePath
      ? [`${basePath}/README.md`, `${basePath}/readme.md`]
      : ['README.md', 'readme.md'];

    for (const readmePath of readmePaths) {
      try {
        const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${readmePath}`;
        const response = await fetch(url);
        if (response.ok) {
          const content = await response.text();
          setReadme(content);
          setIsLoadingReadme(false);
          return;
        }
      } catch {
        // Try next path
      }
    }

    setReadmeError('README not found for this plugin');
    setIsLoadingReadme(false);
  };

  const handleAddMarketplace = async () => {
    const input = addFormInput.trim();
    const parts = input.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setAddError('Enter a valid owner/repo (e.g. "myorg/my-plugins")');
      return;
    }
    const [owner, repo] = parts;
    setIsAdding(true);
    setAddError(null);
    try {
      await addPluginMarketplace(
        owner,
        repo,
        addFormBranch.trim() || undefined,
        addFormPath.trim() || undefined,
      );
      setShowAddForm(false);
      setAddFormInput('');
      setAddFormBranch('');
      setAddFormPath('');
      await loadMarketplaces();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add marketplace');
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveMarketplace = async (owner: string, repo: string) => {
    try {
      await removePluginMarketplace(owner, repo);
      await loadMarketplaces();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove marketplace');
    }
  };

  const handleDetailTabChange = (tab: DetailTab) => {
    setDetailTab(tab);
    if (tab === 'readme' && selectedPlugin && !readme && !readmeError) {
      loadReadme(selectedPlugin);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'hsl(var(--text-muted))' }}>
        <Loader2 size={16} className="animate-spin mr-2" />
        <span className="text-xs">Loading plugin marketplaces...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3" style={{ color: 'hsl(var(--text-muted))' }}>
        <span className="text-xs" style={{ color: 'hsl(var(--red))' }}>{error}</span>
        <button
          onClick={loadMarketplaces}
          className="text-xs px-3 py-1.5 border"
          style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--text-secondary))' }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'hsl(var(--bg-base))' }}>
      {/* Header */}
      <div
        className="flex-none border-b px-4 py-3"
        style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--bg-surface))' }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Store size={14} style={{ color: 'hsl(var(--cyan))' }} />
            <span className="text-xs font-medium" style={{ color: 'hsl(var(--text-primary))' }}>
              Plugin Marketplace
            </span>
            <span
              className="text-[10px] px-1.5 py-0.5"
              style={{ background: 'hsl(var(--bg-elevated))', color: 'hsl(var(--text-muted))' }}
            >
              {totalCount} plugins
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex" style={{ border: '1px solid hsl(var(--border))' }}>
              <button
                onClick={() => setLayout('grid')}
                className="p-1"
                style={{
                  background: layout === 'grid' ? 'hsl(var(--bg-elevated))' : 'transparent',
                  color: layout === 'grid' ? 'hsl(var(--text-primary))' : 'hsl(var(--text-muted))',
                }}
              >
                <Grid3X3 size={12} />
              </button>
              <button
                onClick={() => setLayout('list')}
                className="p-1"
                style={{
                  background: layout === 'list' ? 'hsl(var(--bg-elevated))' : 'transparent',
                  color: layout === 'list' ? 'hsl(var(--text-primary))' : 'hsl(var(--text-muted))',
                }}
              >
                <List size={12} />
              </button>
            </div>
            <button
              onClick={() => { setShowAddForm(!showAddForm); setAddError(null); }}
              className="p-1"
              style={{ color: showAddForm ? 'hsl(var(--cyan))' : 'hsl(var(--text-muted))' }}
              title="Add custom marketplace"
            >
              <Plus size={12} />
            </button>
            <button
              onClick={loadMarketplaces}
              className="p-1"
              style={{ color: 'hsl(var(--text-muted))' }}
              title="Refresh"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2"
            style={{ color: 'hsl(var(--text-muted))' }}
          />
          {isSearching && (
            <Loader2
              size={12}
              className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin"
              style={{ color: 'hsl(var(--text-muted))' }}
            />
          )}
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search plugins by name, description, or tags..."
            className="w-full text-xs pl-7 pr-7 py-1.5 outline-none"
            style={{
              background: 'hsl(var(--bg-base))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--text-primary))',
            }}
          />
        </div>

        {/* Add marketplace form */}
        {showAddForm && (
          <div
            className="mt-2 p-2 space-y-1.5"
            style={{ background: 'hsl(var(--bg-base))', border: '1px solid hsl(var(--border))' }}
          >
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={addFormInput}
                onChange={e => setAddFormInput(e.target.value)}
                placeholder="owner/repo"
                className="flex-1 text-xs px-2 py-1 outline-none"
                style={{
                  background: 'hsl(var(--bg-surface))',
                  border: '1px solid hsl(var(--border))',
                  color: 'hsl(var(--text-primary))',
                }}
                onKeyDown={e => { if (e.key === 'Enter') handleAddMarketplace(); }}
              />
              <button
                onClick={handleAddMarketplace}
                disabled={isAdding || !addFormInput.trim()}
                className="text-[10px] px-2 py-1"
                style={{
                  background: 'hsl(var(--cyan) / 0.15)',
                  color: 'hsl(var(--cyan))',
                  border: '1px solid hsl(var(--cyan) / 0.4)',
                  opacity: isAdding || !addFormInput.trim() ? 0.5 : 1,
                }}
              >
                {isAdding ? <Loader2 size={10} className="animate-spin" /> : 'Add'}
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={addFormBranch}
                onChange={e => setAddFormBranch(e.target.value)}
                placeholder="branch (default: main)"
                className="flex-1 text-[10px] px-2 py-0.5 outline-none"
                style={{
                  background: 'hsl(var(--bg-surface))',
                  border: '1px solid hsl(var(--border))',
                  color: 'hsl(var(--text-primary))',
                }}
              />
              <input
                type="text"
                value={addFormPath}
                onChange={e => setAddFormPath(e.target.value)}
                placeholder="path (default: .claude-plugin/marketplace.json)"
                className="flex-1 text-[10px] px-2 py-0.5 outline-none"
                style={{
                  background: 'hsl(var(--bg-surface))',
                  border: '1px solid hsl(var(--border))',
                  color: 'hsl(var(--text-primary))',
                }}
              />
            </div>
            {addError && (
              <div className="flex items-center gap-1 text-[10px]" style={{ color: 'hsl(var(--red))' }}>
                <AlertCircle size={10} />
                {addError}
              </div>
            )}
          </div>
        )}

        {/* Marketplace tabs */}
        {marketplaces.length > 0 && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            <button
              onClick={() => setSelectedMarketplace(null)}
              className="text-[10px] px-2 py-0.5"
              style={{
                background: !selectedMarketplace ? 'hsl(var(--cyan) / 0.15)' : 'hsl(var(--bg-elevated))',
                color: !selectedMarketplace ? 'hsl(var(--cyan))' : 'hsl(var(--text-muted))',
                border: '1px solid ' + (!selectedMarketplace ? 'hsl(var(--cyan) / 0.4)' : 'hsl(var(--border))'),
              }}
            >
              All Sources
            </button>
            {marketplaces.map(m => (
              <button
                key={m.slug}
                onClick={() => setSelectedMarketplace(selectedMarketplace === m.slug ? null : m.slug)}
                className="text-[10px] px-2 py-0.5 flex items-center gap-1"
                style={{
                  background: selectedMarketplace === m.slug ? 'hsl(var(--cyan) / 0.15)' : 'hsl(var(--bg-elevated))',
                  color: selectedMarketplace === m.slug ? 'hsl(var(--cyan))' : 'hsl(var(--text-muted))',
                  border: '1px solid ' + (selectedMarketplace === m.slug ? 'hsl(var(--cyan) / 0.4)' : 'hsl(var(--border))'),
                }}
              >
                {m.name}
                <span className="opacity-60">({m.plugins.length})</span>
                {m.isCustom && m.owner && m.repo && (
                  <span
                    onClick={(e) => { e.stopPropagation(); handleRemoveMarketplace(m.owner!, m.repo!); }}
                    className="ml-0.5 hover:text-[hsl(var(--red))] cursor-pointer"
                    title="Remove custom marketplace"
                  >
                    <X size={8} />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Category sidebar */}
        <div
          className="flex-none w-48 border-r overflow-y-auto py-2"
          style={{ borderColor: 'hsl(var(--border))', background: 'hsl(var(--bg-surface))' }}
        >
          <div className="flex items-center gap-1.5 px-3 mb-2">
            <Filter size={10} style={{ color: 'hsl(var(--text-muted))' }} />
            <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'hsl(var(--text-muted))' }}>
              Categories
            </span>
          </div>
          <button
            onClick={() => setSelectedCategory(null)}
            className="w-full text-left px-3 py-1 text-[10px] flex items-center justify-between"
            style={{
              background: !selectedCategory ? 'hsl(var(--bg-elevated))' : 'transparent',
              color: !selectedCategory ? 'hsl(var(--text-primary))' : 'hsl(var(--text-secondary))',
            }}
          >
            <span>All</span>
            <span style={{ color: 'hsl(var(--text-muted))' }}>{totalCount}</span>
          </button>
          {categories.map(([cat, count]) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
              className="w-full text-left px-3 py-1 text-[10px] flex items-center justify-between"
              style={{
                background: selectedCategory === cat ? 'hsl(var(--bg-elevated))' : 'transparent',
                color: selectedCategory === cat ? 'hsl(var(--text-primary))' : 'hsl(var(--text-secondary))',
              }}
            >
              <span className="truncate mr-2">{cat}</span>
              <span style={{ color: 'hsl(var(--text-muted))' }}>{count}</span>
            </button>
          ))}
        </div>

        {/* Plugin grid/list */}
        <div className="flex-1 overflow-y-auto p-3">
          {/* Info banner */}
          <div
            className="flex items-start gap-2 mb-3 p-2 text-[10px]"
            style={{
              background: 'hsl(var(--bg-surface))',
              border: '1px solid hsl(var(--border))',
              color: 'hsl(var(--text-muted))',
            }}
          >
            <Info size={12} className="flex-none mt-0.5" style={{ color: 'hsl(var(--cyan))' }} />
            <span>
              This is a read-only browse view. To install plugins, go to an Agent Config and use the Plugins tab.
            </span>
          </div>

          {filteredPlugins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <FolderOpen size={24} style={{ color: 'hsl(var(--text-muted))' }} />
              <span className="text-xs" style={{ color: 'hsl(var(--text-muted))' }}>
                {searchResults !== null ? 'No plugins match your search' : 'No plugins available'}
              </span>
            </div>
          ) : layout === 'grid' ? (
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
              {filteredPlugins.map((plugin, i) => (
                <PluginCard
                  key={`${plugin.marketplace}-${plugin.name}-${i}`}
                  plugin={plugin}
                  isSelected={selectedPlugin?.name === plugin.name && selectedPlugin?.marketplace === plugin.marketplace}
                  onClick={() => selectPlugin(plugin)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredPlugins.map((plugin, i) => (
                <PluginRow
                  key={`${plugin.marketplace}-${plugin.name}-${i}`}
                  plugin={plugin}
                  isSelected={selectedPlugin?.name === plugin.name && selectedPlugin?.marketplace === plugin.marketplace}
                  onClick={() => selectPlugin(plugin)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div
          ref={resizeRef}
          className="flex-none flex flex-col border-l bg-[hsl(var(--bg-surface))] relative"
          style={{ width: panelWidth, borderColor: 'hsl(var(--border))' }}
        >
          {/* Resize Handle */}
          <div
            onMouseDown={handleMouseDown}
            className={`absolute left-0 top-0 bottom-0 w-1 cursor-col-resize group hover:bg-[hsl(var(--cyan)/0.3)] transition-colors z-10 ${
              isResizing ? 'bg-[hsl(var(--cyan)/0.5)]' : ''
            }`}
          >
            <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
              <GripVertical className="h-6 w-6 text-[hsl(var(--text-muted))]" />
            </div>
          </div>

          {selectedPlugin ? (
            <>
              {/* Header */}
              <div className="p-4 border-b border-[hsl(var(--border))]">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Package size={14} className="flex-none" style={{ color: 'hsl(var(--cyan))' }} />
                      <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] truncate">
                        {selectedPlugin.name}
                      </h3>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {selectedPlugin.homepage && (
                      <a
                        href={selectedPlugin.homepage}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))]"
                        title="Homepage"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <button
                      onClick={() => setSelectedPlugin(null)}
                      className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Detail Tabs */}
              <div className="flex border-b border-[hsl(var(--border))]">
                <button
                  onClick={() => handleDetailTabChange('info')}
                  className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                    detailTab === 'info'
                      ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
                      : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
                  }`}
                >
                  Info
                </button>
                <button
                  onClick={() => handleDetailTabChange('readme')}
                  className={`flex-1 px-4 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                    detailTab === 'readme'
                      ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
                      : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
                  }`}
                >
                  <BookOpen className="h-3 w-3" />
                  README
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-auto p-4">
                {detailTab === 'info' ? (
                  <div className="space-y-4">
                    {/* Description */}
                    <div>
                      <p className="text-xs text-[hsl(var(--text-secondary))] leading-relaxed">
                        {selectedPlugin.description || 'No description available'}
                      </p>
                    </div>

                    {/* Version */}
                    {selectedPlugin.version && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Version</div>
                        <div className="text-xs text-[hsl(var(--text-primary))] font-mono">
                          v{selectedPlugin.version}
                        </div>
                      </div>
                    )}

                    {/* Category */}
                    {selectedPlugin.category && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Category</div>
                        <span
                          className="text-[10px] px-1.5 py-0.5 inline-block"
                          style={{ background: 'hsl(var(--purple) / 0.15)', color: 'hsl(var(--purple))' }}
                        >
                          {selectedPlugin.category}
                        </span>
                      </div>
                    )}

                    {/* Tags */}
                    {selectedPlugin.tags && selectedPlugin.tags.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                          <Tag className="h-3 w-3" />
                          <span>Tags</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {selectedPlugin.tags.map(tag => (
                            <span
                              key={tag}
                              className="text-[10px] px-1.5 py-0.5"
                              style={{ background: 'hsl(var(--bg-base))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--text-secondary))' }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Source */}
                    {selectedPlugin.marketplace && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Marketplace</div>
                        <span className="text-xs text-[hsl(var(--text-secondary))]">
                          {selectedPlugin.marketplace}
                        </span>
                      </div>
                    )}

                    {/* Source info */}
                    {selectedPlugin.source && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Source</div>
                        <div className="text-[10px] font-mono text-[hsl(var(--text-secondary))] p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
                          <div>Type: {selectedPlugin.source.type}</div>
                          {selectedPlugin.source.url && <div className="truncate">URL: {selectedPlugin.source.url}</div>}
                          {selectedPlugin.source.path && <div className="truncate">Path: {selectedPlugin.source.path}</div>}
                        </div>
                      </div>
                    )}

                    {/* Homepage */}
                    {selectedPlugin.homepage && (
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">Homepage</div>
                        <a
                          href={selectedPlugin.homepage}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-[hsl(var(--cyan))] hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {selectedPlugin.homepage}
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="prose prose-sm prose-invert max-w-none">
                    {isLoadingReadme ? (
                      <div className="flex flex-col items-center justify-center py-8 gap-2">
                        <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
                        <span className="text-[10px] text-[hsl(var(--text-muted))]">Loading README...</span>
                      </div>
                    ) : readmeError ? (
                      <div className="text-center py-8">
                        <BookOpen className="h-8 w-8 mx-auto mb-2 text-[hsl(var(--text-muted))] opacity-30" />
                        <p className="text-xs text-[hsl(var(--text-muted))]">{readmeError}</p>
                        <button
                          onClick={() => loadReadme(selectedPlugin)}
                          className="mt-2 text-[10px] text-[hsl(var(--cyan))] hover:underline"
                        >
                          Try again
                        </button>
                      </div>
                    ) : readme ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                        components={{
                          h1: ({ children }) => <h1 className="text-base font-semibold text-[hsl(var(--text-primary))] mt-4 mb-2">{children}</h1>,
                          h2: ({ children }) => <h2 className="text-sm font-semibold text-[hsl(var(--text-primary))] mt-3 mb-2">{children}</h2>,
                          h3: ({ children }) => <h3 className="text-xs font-semibold text-[hsl(var(--text-primary))] mt-2 mb-1">{children}</h3>,
                          p: ({ children }) => <p className="text-xs text-[hsl(var(--text-secondary))] mb-2 leading-relaxed">{children}</p>,
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" className="text-[hsl(var(--cyan))] hover:underline">
                              {children}
                            </a>
                          ),
                          code: ({ className, children }) => {
                            const isBlock = className?.includes('language-');
                            return isBlock ? (
                              <pre className="bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] p-2 overflow-x-auto text-[10px] my-2">
                                <code>{children}</code>
                              </pre>
                            ) : (
                              <code className="bg-[hsl(var(--bg-base))] px-1 py-0.5 text-[10px] text-[hsl(var(--cyan))]">{children}</code>
                            );
                          },
                          pre: ({ children }) => <>{children}</>,
                          ul: ({ children }) => <ul className="list-disc list-inside text-xs text-[hsl(var(--text-secondary))] mb-2 space-y-0.5">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal list-inside text-xs text-[hsl(var(--text-secondary))] mb-2 space-y-0.5">{children}</ol>,
                          li: ({ children }) => <li className="text-xs">{children}</li>,
                          blockquote: ({ children }) => (
                            <blockquote className="border-l-2 border-[hsl(var(--border))] pl-3 my-2 text-[hsl(var(--text-muted))]">
                              {children}
                            </blockquote>
                          ),
                          table: ({ children }) => (
                            <div className="overflow-x-auto my-2">
                              <table className="text-[10px] border-collapse w-full">{children}</table>
                            </div>
                          ),
                          th: ({ children }) => <th className="border border-[hsl(var(--border))] px-2 py-1 bg-[hsl(var(--bg-base))] text-left">{children}</th>,
                          td: ({ children }) => <td className="border border-[hsl(var(--border))] px-2 py-1">{children}</td>,
                          img: ({ src, alt }) => (
                            <img
                              src={src}
                              alt={alt || ''}
                              className="max-w-full h-auto my-2 rounded"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          ),
                        }}
                      >
                        {readme}
                      </ReactMarkdown>
                    ) : (
                      <div className="text-center py-8 text-xs text-[hsl(var(--text-muted))]">
                        README not available
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-[hsl(var(--text-muted))]">
              <div className="text-center">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-[10px] uppercase tracking-wider">
                  Select a plugin to view details
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PluginCard({ plugin, isSelected, onClick }: { plugin: MarketplacePlugin; isSelected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="p-3 flex flex-col gap-2 cursor-pointer transition-colors"
      style={{
        background: isSelected ? 'hsl(var(--cyan) / 0.08)' : 'hsl(var(--bg-surface))',
        border: isSelected ? '1px solid hsl(var(--cyan) / 0.4)' : '1px solid hsl(var(--border))',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Package size={12} className="flex-none" style={{ color: 'hsl(var(--cyan))' }} />
          <span className="text-xs font-medium truncate" style={{ color: 'hsl(var(--text-primary))' }}>
            {plugin.name}
          </span>
        </div>
        {plugin.homepage && (
          <a
            href={plugin.homepage}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-none"
            style={{ color: 'hsl(var(--text-muted))' }}
            onClick={e => e.stopPropagation()}
          >
            <ExternalLink size={10} />
          </a>
        )}
      </div>

      {/* Description */}
      <p className="text-[10px] line-clamp-2" style={{ color: 'hsl(var(--text-secondary))' }}>
        {plugin.description || 'No description'}
      </p>

      {/* Meta row */}
      <div className="flex items-center gap-2 flex-wrap">
        {plugin.version && (
          <span className="text-[9px] px-1 py-0.5" style={{ background: 'hsl(var(--bg-elevated))', color: 'hsl(var(--text-muted))' }}>
            v{plugin.version}
          </span>
        )}
        {plugin.category && (
          <span
            className="text-[9px] px-1 py-0.5"
            style={{ background: 'hsl(var(--purple) / 0.15)', color: 'hsl(var(--purple))' }}
          >
            {plugin.category}
          </span>
        )}
        {plugin.marketplace && (
          <span className="text-[9px] px-1 py-0.5" style={{ background: 'hsl(var(--bg-elevated))', color: 'hsl(var(--text-muted))' }}>
            {plugin.marketplace}
          </span>
        )}
      </div>

      {/* Tags */}
      {plugin.tags && plugin.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <Tag size={8} className="flex-none" style={{ color: 'hsl(var(--text-muted))' }} />
          {plugin.tags.slice(0, 4).map(tag => (
            <span
              key={tag}
              className="text-[9px] px-1"
              style={{ color: 'hsl(var(--text-muted))' }}
            >
              {tag}
            </span>
          ))}
          {plugin.tags.length > 4 && (
            <span className="text-[9px]" style={{ color: 'hsl(var(--text-muted))' }}>
              +{plugin.tags.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PluginRow({ plugin, isSelected, onClick }: { plugin: MarketplacePlugin; isSelected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors"
      style={{
        background: isSelected ? 'hsl(var(--cyan) / 0.08)' : 'hsl(var(--bg-surface))',
        border: isSelected ? '1px solid hsl(var(--cyan) / 0.4)' : '1px solid hsl(var(--border))',
      }}
    >
      <Package size={12} className="flex-none" style={{ color: 'hsl(var(--cyan))' }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium truncate" style={{ color: 'hsl(var(--text-primary))' }}>
            {plugin.name}
          </span>
          {plugin.version && (
            <span className="text-[9px] px-1 py-0.5 flex-none" style={{ background: 'hsl(var(--bg-elevated))', color: 'hsl(var(--text-muted))' }}>
              v{plugin.version}
            </span>
          )}
          {plugin.category && (
            <span
              className="text-[9px] px-1 py-0.5 flex-none"
              style={{ background: 'hsl(var(--purple) / 0.15)', color: 'hsl(var(--purple))' }}
            >
              {plugin.category}
            </span>
          )}
        </div>
        <p className="text-[10px] truncate" style={{ color: 'hsl(var(--text-muted))' }}>
          {plugin.description || 'No description'}
        </p>
      </div>
      {plugin.tags && plugin.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-none">
          {plugin.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-[9px] px-1" style={{ color: 'hsl(var(--text-muted))' }}>
              {tag}
            </span>
          ))}
        </div>
      )}
      {plugin.marketplace && (
        <span className="text-[9px] px-1 py-0.5 flex-none" style={{ background: 'hsl(var(--bg-elevated))', color: 'hsl(var(--text-muted))' }}>
          {plugin.marketplace}
        </span>
      )}
      {plugin.homepage && (
        <a
          href={plugin.homepage}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-none"
          style={{ color: 'hsl(var(--text-muted))' }}
          onClick={e => e.stopPropagation()}
        >
          <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}
