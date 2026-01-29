import { useState } from 'react';
import { MCPRegistry } from './MCPRegistry';
import { MyMCPServers } from './mcp/MyMCPServers';

type MCPTab = 'registry' | 'my-servers';

export function MCPPage() {
  const [activeTab, setActiveTab] = useState<MCPTab>('registry');

  return (
    <div className="h-full flex flex-col">
      {/* Tab Bar */}
      <div className="flex border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        <button
          onClick={() => setActiveTab('registry')}
          className={`px-6 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'registry'
              ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          Registry
        </button>
        <button
          onClick={() => setActiveTab('my-servers')}
          className={`px-6 py-2.5 text-xs font-medium transition-colors ${
            activeTab === 'my-servers'
              ? 'text-[hsl(var(--cyan))] border-b-2 border-[hsl(var(--cyan))]'
              : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]'
          }`}
        >
          My Servers
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'registry' && <MCPRegistry onDeploy={() => setActiveTab('my-servers')} />}
        {activeTab === 'my-servers' && <MyMCPServers />}
      </div>
    </div>
  );
}
