import { useState, useRef } from 'react';
import { Folder, File, Upload, Download, Trash2, ChevronRight, Home, RefreshCw, Loader2, AlertTriangle, X, FolderUp } from 'lucide-react';
import { useVmVolumeFiles, useUploadFileToVmVolume, useDeleteVmVolumeFile } from '../hooks/useContainers';
import { downloadFileFromVmVolume, VmVolumeFileInfo } from '../api/client';
import { useConfirm } from './ConfirmModal';

interface VolumeFileBrowserProps {
  volumeId: string;
  volumeName: string;
  isAttached: boolean;
  isVmRunning?: boolean;
  onClose: () => void;
}

export function VolumeFileBrowser({ volumeId, volumeName, isAttached, isVmRunning = false, onClose }: VolumeFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  // Can upload if not attached OR if attached and VM is running (SSH upload)
  const canUpload = !isAttached || isVmRunning;

  const { data, isLoading, error, refetch } = useVmVolumeFiles(volumeId, currentPath);
  const uploadFile = useUploadFileToVmVolume();
  const deleteFile = useDeleteVmVolumeFile();

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

  const handleFileClick = (file: VmVolumeFileInfo) => {
    if (file.type === 'directory') {
      const newPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      navigateTo(newPath);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>, isFolder = false) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    let uploadedCount = 0;

    for (const file of fileList) {
      try {
        // For folder uploads, preserve the relative path structure
        let destPath = currentPath;
        if (isFolder && file.webkitRelativePath) {
          // Get the path without the file name
          const parts = file.webkitRelativePath.split('/');
          parts.pop(); // Remove filename
          if (parts.length > 0) {
            const subPath = parts.join('/');
            destPath = currentPath === '/' ? `/${subPath}` : `${currentPath}/${subPath}`;
          }
        }

        setUploadProgress(`Uploading ${++uploadedCount}/${fileList.length}: ${file.name}`);
        await uploadFile.mutateAsync({ volumeId, file, destPath });
      } catch (err) {
        console.error('Upload failed:', err);
      }
    }

    setUploadProgress(null);

    // Clear the inputs
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
    }
  };

  const handleDownload = async (file: VmVolumeFileInfo) => {
    try {
      const filePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      const blob = await downloadFileFromVmVolume(volumeId, filePath);

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

  const handleDelete = async (file: VmVolumeFileInfo) => {
    const confirmed = await confirm({
      title: 'Delete File',
      message: `Are you sure you want to delete "${file.name}"?`,
      confirmText: 'Delete',
      variant: 'danger',
    });

    if (confirmed) {
      const filePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      try {
        await deleteFile.mutateAsync({ volumeId, filePath });
      } catch (err) {
        console.error('Delete failed:', err);
      }
    }
  };

  // Breadcrumb navigation
  const pathParts = currentPath.split('/').filter(Boolean);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] rounded-lg w-[800px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[hsl(var(--border))]">
          <h2 className="text-lg font-semibold text-[hsl(var(--text-primary))]">
            Files: {volumeName}
          </h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-[hsl(var(--bg-elevated))] rounded"
          >
            <X className="w-5 h-5 text-[hsl(var(--text-secondary))]" />
          </button>
        </div>

        {/* Info/warning if attached */}
        {isAttached && (
          <div className={`mx-4 mt-4 p-3 border rounded-lg flex items-center gap-2 ${
            isVmRunning
              ? 'bg-[hsl(var(--cyan)/0.1)] border-[hsl(var(--cyan)/0.3)]'
              : 'bg-[hsl(var(--amber)/0.1)] border-[hsl(var(--amber)/0.3)]'
          }`}>
            <AlertTriangle className={`w-4 h-4 ${isVmRunning ? 'text-[hsl(var(--cyan))]' : 'text-[hsl(var(--amber))]'}`} />
            <span className={`text-sm ${isVmRunning ? 'text-[hsl(var(--cyan))]' : 'text-[hsl(var(--amber))]'}`}>
              {isVmRunning
                ? 'Volume is attached to a running VM. File operations work via SSH.'
                : 'Volume is attached to a stopped VM. Start the VM or detach to manage files.'
              }
            </span>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center gap-2 p-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          {/* Breadcrumb */}
          <div className="flex items-center gap-1 flex-1 min-w-0 text-sm">
            <button
              onClick={() => navigateTo('/')}
              className="p-1 hover:bg-[hsl(var(--bg-elevated))] rounded text-[hsl(var(--text-secondary))]"
              title="Root"
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
          {canUpload && (
            <>
              <label className="cursor-pointer">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={(e) => handleUpload(e, false)}
                  className="hidden"
                />
                <span className="flex items-center gap-1 px-2 py-1 bg-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.8)] text-white rounded text-sm">
                  <Upload className="w-4 h-4" />
                  Files
                </span>
              </label>
              <label className="cursor-pointer">
                <input
                  ref={folderInputRef}
                  type="file"
                  // @ts-expect-error webkitdirectory is not in the standard types
                  webkitdirectory="true"
                  onChange={(e) => handleUpload(e, true)}
                  className="hidden"
                />
                <span className="flex items-center gap-1 px-2 py-1 bg-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.8)] text-white rounded text-sm">
                  <FolderUp className="w-4 h-4" />
                  Folder
                </span>
              </label>
            </>
          )}
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
                        {canUpload && (
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
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {data?.files.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-[hsl(var(--text-muted))]">
                      Empty directory
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Upload progress */}
        {(uploadFile.isPending || uploadProgress) && (
          <div className="p-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--text-secondary))]">
              <Loader2 className="w-4 h-4 animate-spin" />
              {uploadProgress || 'Uploading...'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
