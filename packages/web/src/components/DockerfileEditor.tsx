/**
 * DockerfileEditor - Dockerfile management and build
 *
 * Features:
 * - File list panel (toggleable: left sidebar or top bar)
 * - Each file shows: name, modified date, build status, quick build button
 * - Monaco editor with syntax highlighting
 * - AI assistant for Dockerfile modifications
 * - Build with streaming logs
 */

import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import {
  Save,
  Trash2,
  Plus,
  FileCode,
  Loader2,
  Hammer,
  X,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Send,
  PanelRightClose,
  PanelRightOpen,
  Check,
  Copy,
  RotateCcw,
  Pencil,
  PanelLeft,
  PanelTop,
  Image,
  Clock,
  Settings,
  Eye,
  EyeOff,
  File,
} from 'lucide-react';
import { useDockerfiles, useImages } from '../hooks/useContainers';
import { useConfirm } from './ConfirmModal';
import { useTheme } from '../hooks/useTheme';
import * as api from '../api/client';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type PanelPosition = 'left' | 'top';

export function DockerfileEditor() {
  // File list panel position
  const [panelPosition, setPanelPosition] = useState<PanelPosition>(() => {
    const saved = localStorage.getItem('handler:dockerfile-panel-position');
    return (saved as PanelPosition) || 'left';
  });

  // Template state
  const [templates, setTemplates] = useState<api.TemplateInfo[]>([]);
  const [showTemplateSelector, setShowTemplateSelector] = useState(false);
  const [showSystemFiles, setShowSystemFiles] = useState<boolean>(() => {
    const saved = localStorage.getItem('handler:dockerfile-show-system');
    return saved !== 'false'; // Default to true
  });

  // Dockerfile state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Build state
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildingFile, setBuildingFile] = useState<string | null>(null);
  const [buildLogs, setBuildLogs] = useState<string[]>([]);
  const [buildResult, setBuildResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isLogsExpanded, setIsLogsExpanded] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Build conflict modal state
  const [buildConflict, setBuildConflict] = useState<{
    dockerfileName: string;
    existingImage: { id: string; tag: string; created: string };
  } | null>(null);

  // AI Panel state
  const [isAIPanelOpen, setIsAIPanelOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [copiedCode, setCopiedCode] = useState<number | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const { data: files, refetch: refetchFiles } = useDockerfiles();
  const { data: images } = useImages();
  const confirm = useConfirm();
  const { isDark } = useTheme();

  // Save panel position
  useEffect(() => {
    localStorage.setItem('handler:dockerfile-panel-position', panelPosition);
  }, [panelPosition]);

  // Save show system files preference
  useEffect(() => {
    localStorage.setItem('handler:dockerfile-show-system', String(showSystemFiles));
  }, [showSystemFiles]);

  // Get image built from a dockerfile
  const getImageForDockerfile = (dockerfileName: string) => {
    return images?.find(img => img.dockerfileName === dockerfileName);
  };

  // Check if selected file is a system file
  const selectedFileInfo = files?.find(f => f.name === selectedFile);
  const isSystemFile = selectedFileInfo?.isSystem ?? false;

  // Format relative time
  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  };

  // Fetch templates on mount
  useEffect(() => {
    api.listTemplates().then(setTemplates).catch(console.error);
  }, []);

  // Load Dockerfile content when selected
  useEffect(() => {
    if (selectedFile) {
      api.getDockerfile(selectedFile).then((result) => {
        setContent(result.content);
      }).catch((err) => {
        console.error('Failed to load dockerfile:', err);
      });
    } else {
      setContent('');
    }
  }, [selectedFile]);

  // Auto-scroll logs
  useEffect(() => {
    if (logsEndRef.current && isLogsExpanded) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [buildLogs, isLogsExpanded]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages]);

  // Check AI status
  useEffect(() => {
    api.getAIStatus().then((status) => {
      setAiConfigured(status.configured);
    }).catch(() => {
      setAiConfigured(false);
    });
  }, []);

  // Create new file - show template selector
  const handleNewClick = () => {
    setSelectedFile(null);
    setContent('');
    setIsCreating(false);
    setNewFileName('');
    setShowTemplateSelector(true);
  };

  // Select template and start creation
  const handleSelectTemplate = async (templateName: string) => {
    try {
      const template = await api.getTemplate(templateName);
      setContent(template.content);
      setShowTemplateSelector(false);
      setIsCreating(true);
    } catch (error) {
      console.error('Failed to load template:', error);
    }
  };

  const handleCreate = async () => {
    if (!newFileName.trim() || !content) return;
    setIsSaving(true);
    try {
      const name = newFileName.trim().replace('.dockerfile', '');
      await api.saveDockerfile(name, content);
      setSelectedFile(name);
      setNewFileName('');
      setIsCreating(false);
      refetchFiles();
    } catch (error) {
      console.error('Failed to create:', error);
    }
    setIsSaving(false);
  };

  const handleSave = async () => {
    if (!selectedFile) return;
    setIsSaving(true);
    try {
      await api.saveDockerfile(selectedFile, content);
      refetchFiles();
    } catch (error) {
      console.error('Failed to save:', error);
    }
    setIsSaving(false);
  };

  const handleDelete = async (name: string) => {
    const confirmed = await confirm({
      title: 'Delete Dockerfile',
      message: `Are you sure you want to delete "${name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await api.deleteDockerfile(name);
      if (selectedFile === name) {
        setSelectedFile(null);
        setContent('');
      }
      refetchFiles();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
    setIsDeleting(false);
  };

  const handleRename = async (oldName: string) => {
    if (!renameValue.trim() || renameValue.trim() === oldName) {
      setEditingName(null);
      return;
    }

    const newName = renameValue.trim().replace('.dockerfile', '');
    setIsSaving(true);
    try {
      await api.renameDockerfile(oldName, newName);
      if (selectedFile === oldName) {
        setSelectedFile(newName);
      }
      setEditingName(null);
      refetchFiles();
    } catch (error) {
      console.error('Failed to rename:', error);
    }
    setIsSaving(false);
  };

  // Build operations
  const handleBuild = async (name?: string, version?: string) => {
    const targetFile = name || selectedFile;
    if (!targetFile) return;

    // If building a different file, select it first
    if (name && name !== selectedFile) {
      setSelectedFile(name);
    }

    // Check if an image with this name already exists (unless we have a version override)
    if (!version) {
      const expectedTag = `handler-${targetFile.toLowerCase()}:latest`;
      const existingImage = images?.find(img =>
        img.repoTags.some(tag => tag === expectedTag)
      );

      if (existingImage) {
        const matchingTag = existingImage.repoTags.find(tag => tag === expectedTag) || existingImage.repoTags[0];
        setBuildConflict({
          dockerfileName: targetFile,
          existingImage: {
            id: existingImage.id,
            tag: matchingTag,
            created: existingImage.created,
          },
        });
        return;
      }
    }

    // Proceed with build
    executeBuild(targetFile, version);
  };

  const executeBuild = async (targetFile: string, version?: string) => {
    setIsBuilding(true);
    setBuildingFile(targetFile);
    setBuildLogs([]);
    setBuildResult(null);
    setIsLogsExpanded(true);

    try {
      await api.buildDockerfile(
        targetFile,
        (log) => {
          setBuildLogs((prev) => [...prev, log]);
        },
        (tag) => {
          setBuildResult({ type: 'success', message: `Built: ${tag}` });
          setIsBuilding(false);
          setBuildingFile(null);
        },
        (error) => {
          setBuildResult({ type: 'error', message: error });
          setIsBuilding(false);
          setBuildingFile(null);
        },
        version
      );
    } catch {
      setIsBuilding(false);
      setBuildingFile(null);
    }
  };

  const handleBuildConflictOverwrite = () => {
    if (!buildConflict) return;
    const { dockerfileName } = buildConflict;
    setBuildConflict(null);
    executeBuild(dockerfileName); // Build with :latest, overwrites existing
  };

  const handleBuildConflictVersion = () => {
    if (!buildConflict) return;
    const { dockerfileName } = buildConflict;
    setBuildConflict(null);
    // Generate timestamp version
    const version = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    executeBuild(dockerfileName, version);
  };

  // AI functions
  const extractDockerfileFromResponse = (response: string): string | null => {
    const match = response.match(/```(?:dockerfile|Dockerfile)?\n([\s\S]*?)```/);
    return match ? match[1].trim() : null;
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || isStreaming) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsStreaming(true);
    setChatMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      await api.streamDockerfileChat(
        userMessage,
        content,
        (chunk) => {
          setChatMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...lastMsg, content: lastMsg.content + chunk }];
            }
            return prev;
          });
        },
        () => setIsStreaming(false),
        (error) => {
          setChatMessages((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...lastMsg, content: `Error: ${error}` }];
            }
            return prev;
          });
          setIsStreaming(false);
        }
      );
    } catch {
      setIsStreaming(false);
    }
  };

  const handleApplyDockerfile = (dockerfile: string) => {
    setContent(dockerfile);
  };

  const handleCopyCode = async (code: string, index: number) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(index);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const renderMessageContent = (msgContent: string) => {
    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(msgContent)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'text', content: msgContent.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'code', content: match[2], language: match[1] || 'plaintext' });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < msgContent.length) {
      parts.push({ type: 'text', content: msgContent.slice(lastIndex) });
    }

    return parts.map((part, idx) => {
      if (part.type === 'code') {
        return (
          <div key={idx} className="my-2 overflow-hidden border border-[hsl(var(--border-highlight))]">
            <div className="flex items-center justify-between px-2.5 py-1 bg-[hsl(var(--bg-base))] text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">
              <span>{part.language}</span>
            </div>
            <pre className="p-2.5 bg-[hsl(var(--bg-surface))] overflow-x-auto text-xs leading-relaxed">
              <code className="text-[hsl(var(--text-primary))]">{part.content}</code>
            </pre>
          </div>
        );
      }
      return <span key={idx} className="whitespace-pre-wrap">{part.content}</span>;
    });
  };

  // File list item component
  const FileListItem = ({ file }: { file: api.DockerfileInfo }) => {
    const isSelected = selectedFile === file.name;
    const isEditing = editingName === file.name;
    const isBuildingThis = buildingFile === file.name;
    const image = getImageForDockerfile(file.name);

    if (isEditing) {
      return (
        <div className={`p-2 border ${isSelected ? 'border-[hsl(var(--cyan))]' : 'border-[hsl(var(--border))]'} bg-[hsl(var(--bg-surface))]`}>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(file.name);
                if (e.key === 'Escape') setEditingName(null);
              }}
              className="flex-1 px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--cyan))] text-[hsl(var(--text-primary))]"
              autoFocus
            />
            <button onClick={() => handleRename(file.name)} disabled={isSaving} className="p-1 text-[hsl(var(--green))]">
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </button>
            <button onClick={() => setEditingName(null)} className="p-1 text-[hsl(var(--text-muted))]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        className={`group p-2 cursor-pointer border transition-colors ${
          isSelected
            ? 'border-[hsl(var(--cyan))] bg-[hsl(var(--cyan)/0.1)]'
            : 'border-transparent hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--bg-surface))]'
        }`}
        onClick={() => setSelectedFile(file.name)}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {file.isSystem ? (
              <Settings className={`h-4 w-4 flex-shrink-0 ${isSelected ? 'text-[hsl(var(--purple))]' : 'text-[hsl(var(--text-muted))]'}`} />
            ) : (
              <FileCode className={`h-4 w-4 flex-shrink-0 ${isSelected ? 'text-[hsl(var(--cyan))]' : 'text-[hsl(var(--text-muted))]'}`} />
            )}
            <span className={`text-xs font-medium truncate ${isSelected ? (file.isSystem ? 'text-[hsl(var(--purple))]' : 'text-[hsl(var(--cyan))]') : 'text-[hsl(var(--text-primary))]'}`}>
              {file.name}
            </span>
            {file.isSystem && (
              <span className="px-1 py-0.5 text-[9px] bg-[hsl(var(--purple)/0.1)] text-[hsl(var(--purple))] border border-[hsl(var(--purple)/0.2)]">
                system
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => { e.stopPropagation(); handleBuild(file.name); }}
              disabled={isBuilding}
              className="p-1 text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)]"
              title="Build"
            >
              {isBuildingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hammer className="h-3.5 w-3.5" />}
            </button>
            {!file.isSystem && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setEditingName(file.name); setRenameValue(file.name); }}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))]"
                  title="Rename"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(file.name); }}
                  disabled={isDeleting}
                  className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--red))]"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1 ml-6 text-[10px] text-[hsl(var(--text-muted))]">
          {file.isSystem && file.description ? (
            <span className="truncate">{file.description}</span>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatRelativeTime(file.modifiedAt)}
              </span>
              {image && (
                <span className="flex items-center gap-1 text-[hsl(var(--green))]" title={`Built as ${image.repoTags[0]}`}>
                  <Image className="h-3 w-3" />
                  built
                </span>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  // Filter files based on showSystemFiles
  const filteredFiles = files?.filter(f => showSystemFiles || !f.isSystem) || [];

  // File list panel
  const FileListPanel = () => (
    <div className={`flex flex-col bg-[hsl(var(--bg-surface))] ${
      panelPosition === 'left' ? 'w-64 border-r' : 'h-32 border-b'
    } border-[hsl(var(--border))]`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))]">
        <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wider">Dockerfiles</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSystemFiles(!showSystemFiles)}
            className={`p-1 ${showSystemFiles ? 'text-[hsl(var(--purple))]' : 'text-[hsl(var(--text-muted))]'} hover:text-[hsl(var(--purple))]`}
            title={showSystemFiles ? 'Hide system templates' : 'Show system templates'}
          >
            {showSystemFiles ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </button>
          <button
            onClick={handleNewClick}
            className="p-1 text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)]"
            title="New Dockerfile"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            onClick={() => setPanelPosition(panelPosition === 'left' ? 'top' : 'left')}
            className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
            title={panelPosition === 'left' ? 'Move to top' : 'Move to left'}
          >
            {panelPosition === 'left' ? <PanelTop className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* File list */}
      <div className={`flex-1 overflow-auto ${panelPosition === 'top' ? 'flex gap-2 p-2' : 'p-1'}`}>
        {filteredFiles.length === 0 ? (
          <div className={`text-center ${panelPosition === 'top' ? 'flex items-center' : 'py-8'}`}>
            <p className="text-xs text-[hsl(var(--text-muted))]">No Dockerfiles yet</p>
          </div>
        ) : panelPosition === 'top' ? (
          // Horizontal layout for top panel
          filteredFiles.map((file) => {
            const isSelected = selectedFile === file.name;
            const isBuildingThis = buildingFile === file.name;
            const image = getImageForDockerfile(file.name);
            const selectedColor = file.isSystem ? 'purple' : 'cyan';
            return (
              <div
                key={file.name}
                onClick={() => setSelectedFile(file.name)}
                className={`flex-shrink-0 px-3 py-2 cursor-pointer border transition-colors ${
                  isSelected
                    ? `border-[hsl(var(--${selectedColor}))] bg-[hsl(var(--${selectedColor})/0.1)]`
                    : 'border-[hsl(var(--border))] hover:border-[hsl(var(--border-highlight))]'
                }`}
              >
                <div className="flex items-center gap-2">
                  {file.isSystem ? (
                    <Settings className={`h-4 w-4 ${isSelected ? 'text-[hsl(var(--purple))]' : 'text-[hsl(var(--text-muted))]'}`} />
                  ) : (
                    <FileCode className={`h-4 w-4 ${isSelected ? 'text-[hsl(var(--cyan))]' : 'text-[hsl(var(--text-muted))]'}`} />
                  )}
                  <span className={`text-xs font-medium ${isSelected ? `text-[hsl(var(--${selectedColor}))]` : 'text-[hsl(var(--text-primary))]'}`}>
                    {file.name}
                  </span>
                  {file.isSystem && (
                    <span className="px-1 py-0.5 text-[8px] bg-[hsl(var(--purple)/0.1)] text-[hsl(var(--purple))] border border-[hsl(var(--purple)/0.2)]">
                      sys
                    </span>
                  )}
                  {image && <Image className="h-3 w-3 text-[hsl(var(--green))]" />}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleBuild(file.name); }}
                    disabled={isBuilding}
                    className="p-0.5 text-[hsl(var(--amber))] hover:bg-[hsl(var(--amber)/0.1)]"
                    title="Build"
                  >
                    {isBuildingThis ? <Loader2 className="h-3 w-3 animate-spin" /> : <Hammer className="h-3 w-3" />}
                  </button>
                </div>
                <div className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
                  {file.isSystem && file.description ? file.description : formatRelativeTime(file.modifiedAt)}
                </div>
              </div>
            );
          })
        ) : (
          // Vertical layout for left panel
          filteredFiles.map((file) => <FileListItem key={file.name} file={file} />)
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      {/* Top panel position */}
      {panelPosition === 'top' && <FileListPanel />}

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel position */}
        {panelPosition === 'left' && <FileListPanel />}

        {/* Editor area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Editor Toolbar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
            <div className="flex items-center gap-3">
              {isCreating ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') { setIsCreating(false); setNewFileName(''); }
                    }}
                    placeholder="filename"
                    className="w-40 px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--cyan))] text-[hsl(var(--text-primary))]"
                    autoFocus
                  />
                  <button
                    onClick={handleCreate}
                    disabled={!newFileName.trim() || isSaving}
                    className="px-2 py-1 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] disabled:opacity-50"
                  >
                    {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create'}
                  </button>
                  <button onClick={() => { setIsCreating(false); setNewFileName(''); setContent(''); }} className="p-1 text-[hsl(var(--text-muted))]">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : selectedFile ? (
                <div className="flex items-center gap-2">
                  <FileCode className="h-4 w-4 text-[hsl(var(--cyan))]" />
                  <span className="text-sm font-medium text-[hsl(var(--text-primary))]">{selectedFile}</span>
                </div>
              ) : (
                <span className="text-sm text-[hsl(var(--text-muted))]">Select or create a Dockerfile</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* AI Toggle */}
              {selectedFile && (
                <button
                  onClick={() => aiConfigured && setIsAIPanelOpen(!isAIPanelOpen)}
                  disabled={!aiConfigured}
                  title={!aiConfigured ? 'Set OPENROUTER_API_KEY to enable AI' : 'AI Assistant'}
                  className={`flex items-center gap-1.5 px-2 py-1 text-xs transition-colors ${
                    !aiConfigured ? 'text-[hsl(var(--text-muted))] cursor-not-allowed'
                      : isAIPanelOpen ? 'bg-[hsl(var(--purple)/0.2)] text-[hsl(var(--purple))] border border-[hsl(var(--purple)/0.3)]'
                      : 'text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.1)] border border-[hsl(var(--purple)/0.3)]'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {isAIPanelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
                </button>
              )}

              {/* Action Buttons */}
              {selectedFile && (
                <>
                  {isSystemFile ? (
                    <span className="flex items-center gap-1.5 px-2 py-1 text-xs text-[hsl(var(--purple))] bg-[hsl(var(--purple)/0.1)] border border-[hsl(var(--purple)/0.2)]">
                      <Settings className="h-3.5 w-3.5" />
                      Read-only system template
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="flex items-center gap-1 px-2 py-1 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save
                      </button>
                      <button
                        onClick={() => handleDelete(selectedFile)}
                        disabled={isDeleting}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-[hsl(var(--red))] hover:bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.3)] disabled:opacity-50"
                      >
                        {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Delete
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => handleBuild()}
                    disabled={isBuilding}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-[hsl(var(--amber))] text-[hsl(var(--bg-base))] disabled:opacity-50"
                  >
                    {buildingFile === selectedFile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Hammer className="h-3.5 w-3.5" />}
                    Build
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Editor + AI Panel */}
          <div className="flex-1 flex overflow-hidden">
            {/* Editor */}
            <div className="flex-1 min-w-0">
              {selectedFile || isCreating ? (
                <Editor
                  height="100%"
                  defaultLanguage="dockerfile"
                  value={content}
                  onChange={(value) => !isSystemFile && setContent(value || '')}
                  theme={isDark ? 'vs-dark' : 'light'}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace",
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                    padding: { top: 12, bottom: 12 },
                    readOnly: isSystemFile,
                  }}
                />
              ) : (
                <div className="h-full flex items-center justify-center bg-[hsl(var(--bg-base))]">
                  {showTemplateSelector ? (
                    <div className="text-center max-w-md">
                      <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] mb-4">Choose a template</h3>
                      <div className="space-y-2">
                        {/* Blank option */}
                        <button
                          onClick={() => {
                            setContent('FROM ubuntu:24.04\n\n');
                            setShowTemplateSelector(false);
                            setIsCreating(true);
                          }}
                          className="w-full px-4 py-3 text-left bg-[hsl(var(--bg-surface))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] hover:border-[hsl(var(--cyan)/0.5)] transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <File className="h-4 w-4 text-[hsl(var(--text-muted))]" />
                            <span className="text-sm font-medium text-[hsl(var(--text-primary))]">blank</span>
                          </div>
                          <div className="text-xs text-[hsl(var(--text-muted))] mt-1 ml-6">Start from scratch with just FROM ubuntu:24.04</div>
                        </button>
                        {/* System templates */}
                        {templates.map((template) => (
                          <button
                            key={template.name}
                            onClick={() => handleSelectTemplate(template.name)}
                            className="w-full px-4 py-3 text-left bg-[hsl(var(--bg-surface))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] hover:border-[hsl(var(--purple)/0.5)] transition-colors"
                          >
                            <div className="flex items-center gap-2">
                              <Settings className="h-4 w-4 text-[hsl(var(--purple))]" />
                              <span className="text-sm font-medium text-[hsl(var(--text-primary))]">{template.name}</span>
                              <span className="px-1 py-0.5 text-[8px] bg-[hsl(var(--purple)/0.1)] text-[hsl(var(--purple))] border border-[hsl(var(--purple)/0.2)]">system</span>
                            </div>
                            <div className="text-xs text-[hsl(var(--text-muted))] mt-1 ml-6">{template.description}</div>
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => setShowTemplateSelector(false)}
                        className="mt-4 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-secondary))]"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="text-center">
                      <FileCode className="h-12 w-12 mx-auto mb-4 text-[hsl(var(--text-muted))] opacity-30" />
                      <p className="text-sm text-[hsl(var(--text-muted))]">Select a Dockerfile or create a new one</p>
                      <button
                        onClick={handleNewClick}
                        className="mt-4 flex items-center gap-2 mx-auto px-3 py-1.5 text-xs text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.3)]"
                      >
                        <Plus className="h-4 w-4" />
                        New Dockerfile
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* AI Side Panel */}
            {isAIPanelOpen && selectedFile && (
              <div className="w-80 flex flex-col border-l border-[hsl(var(--border))] bg-[hsl(var(--bg-surface))]">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))]">
                  <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--purple))]">
                    <Sparkles className="h-4 w-4" />
                    AI Assistant
                  </div>
                  <div className="flex items-center gap-1">
                    {chatMessages.length > 0 && (
                      <button onClick={() => setChatMessages([])} disabled={isStreaming} className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] disabled:opacity-50" title="Clear">
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button onClick={() => setIsAIPanelOpen(false)} className="p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {chatMessages.length === 0 && (
                    <div className="text-center py-6">
                      <Sparkles className="h-6 w-6 mx-auto mb-2 text-[hsl(var(--purple)/0.3)]" />
                      <p className="text-xs text-[hsl(var(--text-secondary))]">Ask me to modify your Dockerfile</p>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => {
                    const isLastAssistant = msg.role === 'assistant' && i === chatMessages.length - 1;
                    const shouldRender = msg.role === 'assistant' && !(isStreaming && isLastAssistant);

                    return (
                      <div key={i} className={`p-2 text-xs ${msg.role === 'user' ? 'bg-[hsl(var(--cyan)/0.1)] border border-[hsl(var(--cyan)/0.2)] ml-4' : 'bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] mr-4'}`}>
                        <div className="text-[hsl(var(--text-primary))]">
                          {shouldRender ? renderMessageContent(msg.content) : <span className="whitespace-pre-wrap">{msg.content}</span>}
                        </div>
                        {msg.role === 'assistant' && !isStreaming && msg.content && (() => {
                          const dockerfile = extractDockerfileFromResponse(msg.content);
                          if (dockerfile) {
                            return (
                              <div className="mt-2 flex gap-2">
                                <button onClick={() => handleCopyCode(dockerfile, i)} className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] border border-[hsl(var(--border))] text-[hsl(var(--text-secondary))] hover:bg-[hsl(var(--bg-elevated))]">
                                  {copiedCode === i ? <><Check className="h-3 w-3 text-[hsl(var(--green))]" />Copied</> : <><Copy className="h-3 w-3" />Copy</>}
                                </button>
                                <button onClick={() => handleApplyDockerfile(dockerfile)} className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))]">
                                  <Check className="h-3 w-3" />Apply
                                </button>
                              </div>
                            );
                          }
                          return null;
                        })()}
                      </div>
                    );
                  })}
                  {isStreaming && <div className="flex items-center gap-2 text-[hsl(var(--text-muted))] text-xs"><Loader2 className="h-3 w-3 animate-spin" />Processing...</div>}
                  <div ref={chatEndRef} />
                </div>

                <div className="p-3 border-t border-[hsl(var(--border))]">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                      placeholder="Ask AI..."
                      disabled={isStreaming}
                      className="flex-1 px-2 py-1 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] disabled:opacity-50"
                    />
                    <button onClick={handleSendChat} disabled={isStreaming || !chatInput.trim()} className="px-2 py-1 bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] disabled:opacity-50">
                      {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Panel - Build Logs */}
      <div className={`border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))] transition-all ${isLogsExpanded ? 'h-48' : 'h-8'}`}>
        <div
          className="flex items-center justify-between px-4 py-1.5 cursor-pointer hover:bg-[hsl(var(--bg-surface))]"
          onClick={() => setIsLogsExpanded(!isLogsExpanded)}
        >
          <div className="flex items-center gap-2">
            <Hammer className="h-3.5 w-3.5 text-[hsl(var(--text-muted))]" />
            <span className="text-xs text-[hsl(var(--text-muted))]">Build Output</span>
            {isBuilding && <Loader2 className="h-3 w-3 animate-spin text-[hsl(var(--amber))]" />}
            {buildResult && (
              <span className={`text-xs ${buildResult.type === 'success' ? 'text-[hsl(var(--green))]' : 'text-[hsl(var(--red))]'}`}>
                {buildResult.message}
              </span>
            )}
          </div>
          {isLogsExpanded ? <ChevronDown className="h-4 w-4 text-[hsl(var(--text-muted))]" /> : <ChevronUp className="h-4 w-4 text-[hsl(var(--text-muted))]" />}
        </div>

        {isLogsExpanded && (
          <div className="h-[calc(100%-2rem)] overflow-auto px-4 pb-2">
            <pre className="text-xs text-[hsl(var(--text-secondary))] whitespace-pre-wrap leading-relaxed font-mono">
              {buildLogs.length === 0 ? (
                <span className="text-[hsl(var(--text-muted))]">Build output will appear here...</span>
              ) : (
                buildLogs.map((log, i) => <span key={i}>{log}</span>)
              )}
            </pre>
            <div ref={logsEndRef} />
          </div>
        )}
      </div>

      {/* Build Conflict Modal */}
      {buildConflict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in">
          <div className="w-full max-w-md bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] p-6 shadow-lg animate-scale-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-[hsl(var(--amber)/0.1)] rounded">
                <Image className="h-5 w-5 text-[hsl(var(--amber))]" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[hsl(var(--text-primary))]">Image Already Exists</h3>
                <p className="text-xs text-[hsl(var(--text-muted))]">An image with this name already exists</p>
              </div>
            </div>

            <div className="mb-4 p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[hsl(var(--text-muted))]">Tag:</span>
                <span className="font-mono text-[hsl(var(--text-primary))]">{buildConflict.existingImage.tag}</span>
              </div>
              <div className="flex items-center gap-2 text-xs mt-1">
                <span className="text-[hsl(var(--text-muted))]">ID:</span>
                <span className="font-mono text-[hsl(var(--text-muted))]">{buildConflict.existingImage.id.replace('sha256:', '').slice(0, 12)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={handleBuildConflictOverwrite}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left border border-[hsl(var(--border))] hover:border-[hsl(var(--amber)/0.5)] hover:bg-[hsl(var(--amber)/0.05)] transition-colors"
              >
                <div>
                  <div className="text-sm font-medium text-[hsl(var(--text-primary))]">Overwrite</div>
                  <div className="text-[10px] text-[hsl(var(--text-muted))]">Replace the existing :latest image</div>
                </div>
                <RotateCcw className="h-4 w-4 text-[hsl(var(--amber))]" />
              </button>

              <button
                onClick={handleBuildConflictVersion}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left border border-[hsl(var(--border))] hover:border-[hsl(var(--cyan)/0.5)] hover:bg-[hsl(var(--cyan)/0.05)] transition-colors"
              >
                <div>
                  <div className="text-sm font-medium text-[hsl(var(--text-primary))]">Auto-version</div>
                  <div className="text-[10px] text-[hsl(var(--text-muted))]">Create a new versioned image (keeps existing)</div>
                </div>
                <Clock className="h-4 w-4 text-[hsl(var(--cyan))]" />
              </button>

              <button
                onClick={() => setBuildConflict(null)}
                className="w-full px-3 py-2 text-xs text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
