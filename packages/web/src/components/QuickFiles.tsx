import { useState } from 'react';
import { Plus, X, Loader2, Trash2, Edit3, Send, Star, FileText } from 'lucide-react';
import { useQuickFiles, useCreateQuickFile, useUpdateQuickFile, useDeleteQuickFile, useCopyQuickFileToSandbox } from '../hooks/useQuickFiles';
import { useSandboxes } from '../hooks/useSandboxes';
import type { QuickFile } from '../api/client';

interface QuickFileModalProps {
  file?: QuickFile | null;
  onClose: () => void;
  onSave: (data: {
    name: string;
    filename: string;
    destPath: string;
    content: string;
    isDefault: boolean;
  }) => Promise<void>;
}

function QuickFileModal({ file, onClose, onSave }: QuickFileModalProps) {
  const [name, setName] = useState(file?.name || '');
  const [destPath, setDestPath] = useState(file?.destPath || '');
  const [content, setContent] = useState(file?.content || '');
  const [isDefault, setIsDefault] = useState(file?.isDefault || false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!file;

  // Derive filename from destPath
  const derivedFilename = destPath.split('/').pop() || '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !destPath.trim() || !content.trim()) return;

    setIsSaving(true);
    setError(null);

    try {
      await onSave({
        name: name.trim(),
        filename: derivedFilename,
        destPath: destPath.trim(),
        content,
        isDefault,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save quick file');
    }
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-[560px] max-w-[90vw] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
            {isEditing ? 'Edit Quick File' : 'New Quick File'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., My Bashrc"
                autoFocus
                className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                Destination Path *
              </label>
              <input
                type="text"
                value={destPath}
                onChange={(e) => setDestPath(e.target.value)}
                placeholder="e.g., /root/.bashrc or /home/dev/AGENT.md"
                className="w-full px-3 py-2 text-xs font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan))] focus:outline-none"
              />
              <p className="text-[10px] text-[hsl(var(--text-muted))]">
                Full path inside the sandbox where this file will be placed
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
                Content *
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="File contents..."
                rows={10}
                className="w-full px-3 py-2 text-xs font-mono bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] focus:border-[hsl(var(--cyan))] focus:outline-none resize-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsDefault(!isDefault)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs border transition-colors ${
                  isDefault
                    ? 'bg-[hsl(var(--yellow)/0.15)] border-[hsl(var(--yellow)/0.4)] text-[hsl(var(--yellow))]'
                    : 'bg-transparent border-[hsl(var(--border))] text-[hsl(var(--text-muted))] hover:border-[hsl(var(--yellow)/0.4)] hover:text-[hsl(var(--yellow))]'
                }`}
              >
                <Star className={`h-3 w-3 ${isDefault ? 'fill-current' : ''}`} />
                Default
              </button>
              <span className="text-[10px] text-[hsl(var(--text-muted))]">
                Default files are automatically copied into new sandboxes
              </span>
            </div>

            {error && (
              <div className="px-3 py-2 text-xs bg-[hsl(var(--red)/0.1)] text-[hsl(var(--red))] border border-[hsl(var(--red)/0.3)]">
                {error}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !destPath.trim() || !content.trim() || isSaving}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving...
                </>
              ) : (
                isEditing ? 'Save Changes' : 'Add File'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface CopyToSandboxDialogProps {
  file: QuickFile;
  onClose: () => void;
}

function CopyToSandboxDialog({ file, onClose }: CopyToSandboxDialogProps) {
  const { data: sandboxData, isLoading } = useSandboxes({ status: ['running'] });
  const copyMutation = useCopyQuickFileToSandbox();
  const [copyingToId, setCopyingToId] = useState<string | null>(null);
  const [copiedTo, setCopiedTo] = useState<string | null>(null);

  const sandboxes = sandboxData?.sandboxes || [];

  const handleCopy = async (sandboxId: string) => {
    setCopyingToId(sandboxId);
    try {
      await copyMutation.mutateAsync({ fileId: file.id, sandboxId });
      setCopyingToId(null);
      setCopiedTo(sandboxId);
      setTimeout(() => setCopiedTo(null), 2000);
    } catch {
      setCopyingToId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] w-[400px] max-w-[90vw] max-h-[70vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--border))]">
          <div>
            <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">
              Copy to Sandbox
            </h3>
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
              {file.name} → {file.destPath}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
            </div>
          ) : sandboxes.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-xs text-[hsl(var(--text-muted))]">
                No running sandboxes found.
              </p>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                Start a sandbox first to copy files into it.
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {sandboxes.map(sandbox => {
                const isCopying = copyingToId === sandbox.id;
                const isCopied = copiedTo === sandbox.id;
                return (
                  <button
                    key={sandbox.id}
                    onClick={() => handleCopy(sandbox.id)}
                    disabled={copyingToId !== null}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left transition-colors border ${
                      isCopying
                        ? 'border-[hsl(var(--cyan)/0.3)] bg-[hsl(var(--cyan)/0.05)]'
                        : 'border-transparent hover:bg-[hsl(var(--bg-elevated))] hover:border-[hsl(var(--border))]'
                    } disabled:cursor-not-allowed ${copyingToId !== null && !isCopying ? 'opacity-50' : ''}`}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[hsl(var(--text-primary))] truncate">
                        {sandbox.name}
                      </p>
                      <p className="text-[10px] text-[hsl(var(--text-muted))]">
                        {sandbox.backend} · {sandbox.image}
                      </p>
                    </div>
                    {isCopying ? (
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <Loader2 className="h-3 w-3 animate-spin text-[hsl(var(--cyan))]" />
                        <span className="text-[10px] text-[hsl(var(--cyan))]">Copying...</span>
                      </div>
                    ) : isCopied ? (
                      <span className="text-[10px] text-[hsl(var(--green))] shrink-0 ml-2">Copied!</span>
                    ) : (
                      <Send className="h-3 w-3 text-[hsl(var(--text-muted))] shrink-0 ml-2" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {copyMutation.isError && (
            <div className="mt-2 px-3 py-2 text-xs bg-[hsl(var(--red)/0.1)] text-[hsl(var(--red))] border border-[hsl(var(--red)/0.3)]">
              {copyMutation.error instanceof Error ? copyMutation.error.message : 'Failed to copy file'}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end px-4 py-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function QuickFiles() {
  const { data, isLoading } = useQuickFiles();
  const createMutation = useCreateQuickFile();
  const updateMutation = useUpdateQuickFile();
  const deleteMutation = useDeleteQuickFile();

  const [showModal, setShowModal] = useState(false);
  const [editingFile, setEditingFile] = useState<QuickFile | null>(null);
  const [copyingFile, setCopyingFile] = useState<QuickFile | null>(null);

  const files = data?.files || [];

  const handleCreate = async (data: {
    name: string;
    filename: string;
    destPath: string;
    content: string;
    isDefault: boolean;
  }) => {
    await createMutation.mutateAsync(data);
  };

  const handleUpdate = async (data: {
    name: string;
    filename: string;
    destPath: string;
    content: string;
    isDefault: boolean;
  }) => {
    if (!editingFile) return;
    await updateMutation.mutateAsync({ id: editingFile.id, updates: data });
  };

  const handleDelete = async (id: string) => {
    await deleteMutation.mutateAsync(id);
  };

  const openCreateModal = () => {
    setEditingFile(null);
    setShowModal(true);
  };

  const openEditModal = (file: QuickFile) => {
    setEditingFile(file);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingFile(null);
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[hsl(var(--border))]">
          <div>
            <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">
              Quick Files
            </h2>
            <p className="text-xs text-[hsl(var(--text-muted))] mt-1">
              Reusable files that can be copied into sandboxes. Default files are auto-injected on creation.
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
          >
            <Plus className="h-3 w-3" />
            New
          </button>
        </div>

        {/* File Cards */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-[hsl(var(--text-muted))]">
            <FileText className="h-3 w-3" />
            <span>Files ({files.length})</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--text-muted))]" />
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-[hsl(var(--border))]">
              <FileText className="h-8 w-8 text-[hsl(var(--text-muted))] mx-auto mb-2 opacity-50" />
              <p className="text-xs text-[hsl(var(--text-muted))]">
                No quick files yet
              </p>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
                Create files like .bashrc, AGENT.md, or config files to inject into sandboxes
              </p>
              <button
                onClick={openCreateModal}
                className="mt-3 inline-flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
              >
                <Plus className="h-3 w-3" />
                Create First File
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {files.map(file => (
                <div
                  key={file.id}
                  className="bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] overflow-hidden group"
                >
                  <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-elevated))]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-medium text-[hsl(var(--text-primary))] truncate">
                        {file.name}
                      </span>
                      {file.isDefault && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 text-[8px] uppercase tracking-wider bg-[hsl(var(--yellow)/0.2)] text-[hsl(var(--yellow))] shrink-0">
                          <Star className="h-2 w-2 fill-current" />
                          Default
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setCopyingFile(file)}
                        className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-base))] transition-colors opacity-0 group-hover:opacity-100"
                        title="Copy to sandbox"
                      >
                        <Send className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => openEditModal(file)}
                        className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--bg-base))] transition-colors opacity-0 group-hover:opacity-100"
                        title="Edit"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(file.id)}
                        className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))] hover:bg-[hsl(var(--bg-base))] transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <code className="text-[10px] font-mono text-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)] px-1.5 py-0.5">
                        {file.destPath}
                      </code>
                    </div>
                    <pre className="text-[11px] font-mono text-[hsl(var(--text-secondary))] whitespace-pre-wrap break-all max-h-32 overflow-auto">
                      {file.content}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <QuickFileModal
          file={editingFile}
          onClose={closeModal}
          onSave={editingFile ? handleUpdate : handleCreate}
        />
      )}

      {/* Copy to Sandbox Dialog */}
      {copyingFile && (
        <CopyToSandboxDialog
          file={copyingFile}
          onClose={() => setCopyingFile(null)}
        />
      )}
    </div>
  );
}
