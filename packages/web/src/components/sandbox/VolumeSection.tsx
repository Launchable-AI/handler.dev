/**
 * VolumeSection - Displays attached volumes with upload shortcuts
 */

import { useState, useRef } from 'react';
import { HardDrive, Upload, Loader2, Check, X, FolderOpen } from 'lucide-react';
import * as api from '../../api/client';

interface Volume {
  name: string;
  mountPath: string;
}

interface VolumeSectionProps {
  volumes: Volume[];
  sandboxId: string;
  onUploadComplete?: () => void;
}

export function VolumeSection({ volumes, sandboxId: _sandboxId, onUploadComplete }: VolumeSectionProps) {
  const [uploadingVolume, setUploadingVolume] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedVolumeRef = useRef<string | null>(null);

  if (volumes.length === 0) {
    return null;
  }

  const handleUploadClick = (volumeName: string) => {
    selectedVolumeRef.current = volumeName;
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const volumeName = selectedVolumeRef.current;

    if (!file || !volumeName) return;

    setUploadingVolume(volumeName);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      await api.uploadFileToVolume(volumeName, file);
      setUploadSuccess(volumeName);
      setTimeout(() => setUploadSuccess(null), 3000);
      onUploadComplete?.();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingVolume(null);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="mt-3 space-y-1.5">
      <span className="text-[10px] text-[hsl(var(--text-muted))] uppercase tracking-wide flex items-center gap-1">
        <HardDrive className="h-3 w-3" />
        Volumes
      </span>

      <div className="space-y-1">
        {volumes.map((vol) => (
          <div
            key={vol.name}
            className="flex items-center justify-between gap-2 p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-[10px]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen className="h-3 w-3 text-[hsl(var(--text-muted))] flex-shrink-0" />
              <span className="text-[hsl(var(--text-secondary))] truncate" title={vol.name}>
                {vol.name}
              </span>
              <span className="text-[hsl(var(--text-muted))]">→</span>
              <span className="text-[hsl(var(--text-muted))] font-mono truncate" title={vol.mountPath}>
                {vol.mountPath}
              </span>
            </div>

            <button
              onClick={() => handleUploadClick(vol.name)}
              disabled={uploadingVolume === vol.name}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--cyan))] hover:bg-[hsl(var(--cyan)/0.1)] transition-colors disabled:opacity-50"
              title="Upload file to volume"
            >
              {uploadingVolume === vol.name ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : uploadSuccess === vol.name ? (
                <Check className="h-3 w-3 text-[hsl(var(--green))]" />
              ) : (
                <Upload className="h-3 w-3" />
              )}
            </button>
          </div>
        ))}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Error message */}
      {uploadError && (
        <div className="flex items-center gap-1.5 text-[10px] text-[hsl(var(--red))]">
          <X className="h-3 w-3" />
          {uploadError}
        </div>
      )}
    </div>
  );
}
