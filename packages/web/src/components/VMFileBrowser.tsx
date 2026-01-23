import { useState, useRef } from 'react';
import { Folder, File, Upload, Download, Trash2, ChevronRight, Home, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { useVmFiles, useUploadFileToVm, useDeleteVmFile } from '../hooks/useContainers';
import { downloadFileFromVm, VmFileInfo } from '../api/client';
import { useConfirm } from './ConfirmModal';

interface VMFileBrowserProps {
  vmId: string;
  vmName?: string;
  isRunning: boolean;
}

export function VMFileBrowser({ vmId, isRunning }: VMFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/home/agent');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  const { data, isLoading, error, refetch } = useVmFiles(vmId, currentPath, isRunning);
  const uploadFile = useUploadFileToVm();
  const deleteFile = useDeleteVmFile();

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const navigateTo = (path: string) => {
    setCurrentPath(path);
  };

  const navigateUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      setCurrentPath('/' + parts.join('/') || '/');
    }
  };

  const handleFileClick = (file: VmFileInfo) => {
    if (file.type === 'directory') {
      const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      navigateTo(newPath);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      try {
        await uploadFile.mutateAsync({ vmId, file, destPath: currentPath });
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }

    // Clear the input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (file: VmFileInfo) => {
    try {
      const filePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      const blob = await downloadFileFromVm(vmId, filePath);

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  const handleDelete = async (file: VmFileInfo) => {
    const confirmed = await confirm({
      title: 'Delete File',
      message: `Are you sure you want to delete "${file.name}"?${file.type === 'directory' ? ' This will delete all contents.' : ''}`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      const filePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      try {
        await deleteFile.mutateAsync({ vmId, filePath });
      } catch (err) {
        console.error('Delete failed:', err);
      }
    }
  };

  // Breadcrumb navigation
  const pathParts = currentPath.split('/').filter(Boolean);

  if (!isRunning) {
    return (
      <div className="p-4 text-center text-[hsl(var(--text-muted))]">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-[hsl(var(--amber))]" />
        <p>VM must be running to browse files</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[hsl(var(--bg-base))]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 min-w-0 text-sm">
          <button
            onClick={() => navigateTo('/home/agent')}
            className="p-1 hover:bg-[hsl(var(--bg-elevated))] rounded text-[hsl(var(--text-secondary))]"
            title="Home"
          >
            <Home className="w-4 h-4" />
          </button>
          <ChevronRight className="w-4 h-4 text-[hsl(var(--text-muted))]" />
          <button
            onClick={() => navigateTo('/')}
            className="px-1 hover:bg-[hsl(var(--bg-elevated))] rounded text-[hsl(var(--text-secondary))]"
          >
            /
          </button>
          {pathParts.map((part, index) => (
            <span key={index} className="flex items-center gap-1">
              <ChevronRight className="w-4 h-4 text-[hsl(var(--text-muted))]" />
              <button
                onClick={() => navigateTo('/' + pathParts.slice(0, index + 1).join('/'))}
                className="px-1 hover:bg-[hsl(var(--bg-elevated))] rounded text-[hsl(var(--text-secondary))] truncate max-w-[100px]"
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        {/* Actions */}
        <button
          onClick={() => refetch()}
          className="p-1.5 hover:bg-[hsl(var(--bg-elevated))] rounded text-[hsl(var(--text-secondary))]"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
        <label className="cursor-pointer">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleUpload}
            className="hidden"
          />
          <span className="flex items-center gap-1 px-2 py-1 bg-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.8)] text-white rounded text-sm">
            <Upload className="w-4 h-4" />
            Upload
          </span>
        </label>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-[hsl(var(--text-muted))]" />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-[hsl(var(--red))]">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
            <p className="text-sm">Failed to load files</p>
            <p className="text-xs text-[hsl(var(--text-muted))] mt-1">{String(error)}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-[hsl(var(--bg-elevated))] sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-[hsl(var(--text-secondary))]">Name</th>
                <th className="text-right px-3 py-2 font-medium text-[hsl(var(--text-secondary))] w-24">Size</th>
                <th className="text-right px-3 py-2 font-medium text-[hsl(var(--text-secondary))] w-40">Modified</th>
                <th className="w-24"></th>
              </tr>
            </thead>
            <tbody>
              {/* Parent directory */}
              {currentPath !== '/' && (
                <tr
                  className="hover:bg-[hsl(var(--bg-elevated))] cursor-pointer border-b border-[hsl(var(--border))]"
                  onClick={navigateUp}
                >
                  <td className="px-3 py-2 flex items-center gap-2">
                    <Folder className="w-4 h-4 text-[hsl(var(--cyan))]" />
                    <span className="text-[hsl(var(--text-primary))]">..</span>
                  </td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              )}
              {/* Files and directories */}
              {data?.files.map((file) => (
                <tr
                  key={file.name}
                  className="hover:bg-[hsl(var(--bg-elevated))] cursor-pointer group border-b border-[hsl(var(--border))]"
                  onClick={() => handleFileClick(file)}
                >
                  <td className="px-3 py-2 flex items-center gap-2">
                    {file.type === 'directory' ? (
                      <Folder className="w-4 h-4 text-[hsl(var(--cyan))]" />
                    ) : (
                      <File className="w-4 h-4 text-[hsl(var(--text-muted))]" />
                    )}
                    <span className="text-[hsl(var(--text-primary))] truncate">{file.name}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-[hsl(var(--text-secondary))]">
                    {file.type === 'file' ? formatSize(file.size) : '-'}
                  </td>
                  <td className="px-3 py-2 text-right text-[hsl(var(--text-secondary))]">
                    {file.modified}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {file.type === 'file' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(file);
                          }}
                          className="p-1 hover:bg-[hsl(var(--bg-surface))] rounded"
                          title="Download"
                        >
                          <Download className="w-4 h-4 text-[hsl(var(--text-secondary))]" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(file);
                        }}
                        className="p-1 hover:bg-[hsl(var(--red)/0.1)] rounded"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4 text-[hsl(var(--red))]" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {data?.files.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-[hsl(var(--text-muted))]">
                    Empty directory
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Upload progress */}
      {uploadFile.isPending && (
        <div className="p-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
          <div className="flex items-center gap-2 text-sm text-[hsl(var(--text-secondary))]">
            <Loader2 className="w-4 h-4 animate-spin" />
            Uploading...
          </div>
        </div>
      )}
    </div>
  );
}
