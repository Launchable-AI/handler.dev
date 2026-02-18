/**
 * SandboxFileBrowser - Download-only file browser for sandboxes.
 * Shows a directory listing with breadcrumb navigation.
 * Click a file to download, click a directory to navigate into it.
 */

import { useState } from 'react';
import { Folder, File, ChevronRight, Home, RefreshCw, Loader2, Download, X } from 'lucide-react';
import { useSandboxFiles } from '../../hooks/useSandboxes';
import { downloadFileFromSandbox } from '../../api/client';
import type { VmFileInfo } from '../../api/client';

interface SandboxFileBrowserProps {
  sandboxId: string;
  defaultPath?: string;
  onClose: () => void;
}

export function SandboxFileBrowser({ sandboxId, defaultPath = '/', onClose }: SandboxFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(defaultPath);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: fetchError, refetch } = useSandboxFiles(sandboxId, currentPath, true);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const navigateTo = (path: string) => {
    setCurrentPath(path);
    setError(null);
  };

  const navigateUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      navigateTo('/' + parts.join('/') || '/');
    }
  };

  const handleFileClick = async (file: VmFileInfo) => {
    if (file.type === 'directory') {
      const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      navigateTo(newPath);
    } else {
      // Download the file
      const filePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      setDownloadingFile(file.name);
      setError(null);
      try {
        const blob = await downloadFileFromSandbox(sandboxId, filePath);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Download failed');
      } finally {
        setDownloadingFile(null);
      }
    }
  };

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <div className="absolute right-0 top-full mt-1 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-lg z-20 w-80">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))]">
        <div className="flex items-center gap-0.5 flex-1 min-w-0 text-[10px] overflow-x-auto">
          <button
            onClick={() => navigateTo('/')}
            className="p-0.5 hover:bg-[hsl(var(--bg-surface))] text-[hsl(var(--text-secondary))] flex-shrink-0"
            title="Root"
          >
            <Home className="w-3 h-3" />
          </button>
          {pathParts.map((part, index) => (
            <span key={index} className="flex items-center gap-0.5 flex-shrink-0">
              <ChevronRight className="w-2.5 h-2.5 text-[hsl(var(--text-muted))]" />
              <button
                onClick={() => navigateTo('/' + pathParts.slice(0, index + 1).join('/'))}
                className="px-0.5 hover:bg-[hsl(var(--bg-surface))] text-[hsl(var(--text-secondary))] truncate max-w-[80px]"
              >
                {part}
              </button>
            </span>
          ))}
        </div>
        <button
          onClick={() => refetch()}
          className="p-0.5 hover:bg-[hsl(var(--bg-surface))] text-[hsl(var(--text-muted))] flex-shrink-0"
          title="Refresh"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
        <button
          onClick={onClose}
          className="p-0.5 hover:bg-[hsl(var(--bg-surface))] text-[hsl(var(--text-muted))] flex-shrink-0"
          title="Close"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* File list */}
      <div className="max-h-64 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-[hsl(var(--text-muted))]" />
          </div>
        ) : fetchError ? (
          <div className="px-3 py-4 text-center">
            <p className="text-[10px] text-[hsl(var(--red))]">Failed to list files</p>
            <p className="text-[9px] text-[hsl(var(--text-muted))] mt-1">{String(fetchError)}</p>
          </div>
        ) : (
          <>
            {/* Parent directory */}
            {currentPath !== '/' && (
              <button
                onClick={navigateUp}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[hsl(var(--bg-elevated))] border-b border-[hsl(var(--border))] text-left"
              >
                <Folder className="w-3.5 h-3.5 text-[hsl(var(--cyan))] flex-shrink-0" />
                <span className="text-[11px] text-[hsl(var(--text-primary))]">..</span>
              </button>
            )}
            {data?.files.map((file) => (
              <button
                key={file.name}
                onClick={() => handleFileClick(file)}
                disabled={downloadingFile === file.name}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-[hsl(var(--bg-elevated))] border-b border-[hsl(var(--border))] text-left group disabled:opacity-50"
              >
                {file.type === 'directory' ? (
                  <Folder className="w-3.5 h-3.5 text-[hsl(var(--cyan))] flex-shrink-0" />
                ) : downloadingFile === file.name ? (
                  <Loader2 className="w-3.5 h-3.5 text-[hsl(var(--cyan))] flex-shrink-0 animate-spin" />
                ) : (
                  <File className="w-3.5 h-3.5 text-[hsl(var(--text-muted))] flex-shrink-0" />
                )}
                <span className="text-[11px] text-[hsl(var(--text-primary))] truncate flex-1 min-w-0">
                  {file.name}
                </span>
                <span className="text-[9px] text-[hsl(var(--text-muted))] flex-shrink-0">
                  {file.type === 'file' ? formatSize(file.size) : ''}
                </span>
                {file.type === 'file' && downloadingFile !== file.name && (
                  <Download className="w-3 h-3 text-[hsl(var(--text-muted))] opacity-0 group-hover:opacity-100 flex-shrink-0" />
                )}
              </button>
            ))}
            {data?.files.length === 0 && (
              <div className="px-3 py-4 text-center text-[10px] text-[hsl(var(--text-muted))]">
                Empty directory
              </div>
            )}
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="px-2 py-1.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--red)/0.05)]">
          <p className="text-[10px] text-[hsl(var(--red))]">{error}</p>
        </div>
      )}
    </div>
  );
}
