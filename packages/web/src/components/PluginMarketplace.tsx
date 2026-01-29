import { useState, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { getPluginMarketplaces, searchPlugins } from '../api/client';
import type { MarketplaceData, MarketplacePlugin } from '../api/client';

type ViewLayout = 'grid' | 'list';

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

        {/* Marketplace tabs */}
        {marketplaces.length > 1 && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            <button
              onClick={() => setSelectedMarketplace(null)}
              className="text-[10px] px-2 py-0.5"
              style={{
                background: !selectedMarketplace ? 'hsl(var(--cyan-dim))' : 'hsl(var(--bg-elevated))',
                color: !selectedMarketplace ? 'hsl(var(--cyan))' : 'hsl(var(--text-muted))',
                border: '1px solid ' + (!selectedMarketplace ? 'hsl(var(--cyan))' : 'hsl(var(--border))'),
              }}
            >
              All Sources
            </button>
            {marketplaces.map(m => (
              <button
                key={m.slug}
                onClick={() => setSelectedMarketplace(selectedMarketplace === m.slug ? null : m.slug)}
                className="text-[10px] px-2 py-0.5"
                style={{
                  background: selectedMarketplace === m.slug ? 'hsl(var(--cyan-dim))' : 'hsl(var(--bg-elevated))',
                  color: selectedMarketplace === m.slug ? 'hsl(var(--cyan))' : 'hsl(var(--text-muted))',
                  border: '1px solid ' + (selectedMarketplace === m.slug ? 'hsl(var(--cyan))' : 'hsl(var(--border))'),
                }}
              >
                {m.name}
                <span className="ml-1 opacity-60">({m.plugins.length})</span>
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
                <PluginCard key={`${plugin.marketplace}-${plugin.name}-${i}`} plugin={plugin} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {filteredPlugins.map((plugin, i) => (
                <PluginRow key={`${plugin.marketplace}-${plugin.name}-${i}`} plugin={plugin} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PluginCard({ plugin }: { plugin: MarketplacePlugin }) {
  return (
    <div
      className="p-3 flex flex-col gap-2"
      style={{
        background: 'hsl(var(--bg-surface))',
        border: '1px solid hsl(var(--border))',
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

function PluginRow({ plugin }: { plugin: MarketplacePlugin }) {
  return (
    <div
      className="flex items-center gap-3 px-3 py-2"
      style={{
        background: 'hsl(var(--bg-surface))',
        border: '1px solid hsl(var(--border))',
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
        >
          <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}
