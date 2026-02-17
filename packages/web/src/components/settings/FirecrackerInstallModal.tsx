/**
 * FirecrackerInstallModal - Step-by-step wizard for Firecracker installation
 */

import { useState } from 'react';
import { X, Check, Copy, Loader2, ChevronRight, ChevronLeft, Terminal, AlertCircle, CheckCircle, XCircle } from 'lucide-react';
import * as api from '../../api/client';

type Step = 'binary' | 'image' | 'verify';

interface FirecrackerInstallStatus {
  binaryInstalled: boolean;
  binaryVersion?: string;
  imageDownloaded: boolean;
  imagePath?: string;
  kvmAvailable: boolean;
  kvmError?: string;
}

interface FirecrackerInstallModalProps {
  onClose: () => void;
}

export function FirecrackerInstallModal({ onClose }: FirecrackerInstallModalProps) {
  const [step, setStep] = useState<Step>('binary');
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [status, setStatus] = useState<FirecrackerInstallStatus | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const steps: { id: Step; label: string }[] = [
    { id: 'binary', label: 'Binary' },
    { id: 'image', label: 'Image' },
    { id: 'verify', label: 'Verify' },
  ];

  const currentStepIndex = steps.findIndex(s => s.id === step);

  const copyCommand = (command: string, id: string) => {
    navigator.clipboard.writeText(command);
    setCopiedCommand(id);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyError(null);
    try {
      const result = await api.getFirecrackerInstallStatus();
      setStatus(result);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Failed to verify installation');
    } finally {
      setIsVerifying(false);
    }
  };

  const isComplete = status?.binaryInstalled && status?.imageDownloaded && status?.kvmAvailable;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80">
      <div className="w-full max-w-2xl bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--border))]">
          <div>
            <h2 className="text-sm font-medium text-[hsl(var(--text-primary))]">Install Firecracker</h2>
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
              Step-by-step guide to set up Firecracker microVMs
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 py-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center">
              {i > 0 && (
                <div className={`w-12 h-0.5 mx-2 ${i <= currentStepIndex ? 'bg-[hsl(var(--purple))]' : 'bg-[hsl(var(--border))]'}`} />
              )}
              <button
                onClick={() => setStep(s.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  s.id === step
                    ? 'bg-[hsl(var(--purple)/0.2)] text-[hsl(var(--purple))] border border-[hsl(var(--purple)/0.3)]'
                    : i < currentStepIndex
                    ? 'text-[hsl(var(--green))] hover:bg-[hsl(var(--bg-elevated))]'
                    : 'text-[hsl(var(--text-muted))] hover:bg-[hsl(var(--bg-elevated))]'
                }`}
              >
                {i < currentStepIndex ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center rounded-full bg-[hsl(var(--bg-elevated))] text-[10px]">
                    {i + 1}
                  </span>
                )}
                {s.label}
              </button>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 min-h-[300px]">
          {step === 'binary' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] mb-2">
                  Install Firecracker Binary
                </h3>
                <p className="text-xs text-[hsl(var(--text-muted))]">
                  Run this command in your terminal to download and install the Firecracker binary.
                  This script downloads from our S3 bucket for fast, reliable access.
                </p>
              </div>

              <CommandBlock
                command="sudo ./scripts/user/install-firecracker.sh"
                id="binary"
                copied={copiedCommand === 'binary'}
                onCopy={copyCommand}
              />

              <div className="p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-xs text-[hsl(var(--text-muted))]">
                <div className="flex items-start gap-2">
                  <Terminal className="h-4 w-4 text-[hsl(var(--cyan))] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-[hsl(var(--text-secondary))]">What this does:</p>
                    <ul className="mt-1 space-y-0.5 list-disc list-inside">
                      <li>Downloads Firecracker binary from S3</li>
                      <li>Installs to /usr/local/bin/firecracker</li>
                      <li>Also installs the jailer binary for production security</li>
                      <li>Verifies KVM access</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'image' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] mb-2">
                  Download VM Image
                </h3>
                <p className="text-xs text-[hsl(var(--text-muted))]">
                  Download the base VM image for Firecracker. This includes a Linux kernel
                  and root filesystem optimized for fast microVM boot times.
                </p>
              </div>

              <CommandBlock
                command="./scripts/user/download-image.sh"
                id="image"
                copied={copiedCommand === 'image'}
                onCopy={copyCommand}
              />

              <div className="p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] text-xs text-[hsl(var(--text-muted))]">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-[hsl(var(--amber))] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-[hsl(var(--text-secondary))]">Note:</p>
                    <p className="mt-1">
                      The download is approximately 500MB. The image will be stored in
                      <code className="mx-1 px-1 bg-[hsl(var(--bg-elevated))]">data/fc-images/</code>.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'verify' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-[hsl(var(--text-primary))] mb-2">
                  Verify Installation
                </h3>
                <p className="text-xs text-[hsl(var(--text-muted))]">
                  Click the button below to verify that Firecracker is properly installed
                  and ready to run microVMs.
                </p>
              </div>

              <button
                onClick={handleVerify}
                disabled={isVerifying}
                className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-[hsl(var(--purple))] hover:bg-[hsl(var(--purple)/0.1)] border border-[hsl(var(--purple)/0.3)] disabled:opacity-50"
              >
                {isVerifying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Verify Installation
              </button>

              {verifyError && (
                <div className="p-3 bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-xs text-[hsl(var(--red))]">
                  <span className="flex items-center gap-1.5">
                    <XCircle className="h-4 w-4" />
                    {verifyError}
                  </span>
                </div>
              )}

              {status && (
                <div className="space-y-2">
                  <StatusItem
                    label="Firecracker Binary"
                    success={status.binaryInstalled}
                    detail={status.binaryVersion ? `v${status.binaryVersion}` : 'Not found'}
                  />
                  <StatusItem
                    label="VM Image"
                    success={status.imageDownloaded}
                    detail={status.imagePath || 'Not downloaded'}
                  />
                  <StatusItem
                    label="KVM Access"
                    success={status.kvmAvailable}
                    detail={status.kvmError || (status.kvmAvailable ? '/dev/kvm accessible' : 'KVM not available')}
                  />
                </div>
              )}

              {isComplete && (
                <div className="p-4 bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-xs text-[hsl(var(--green))]">
                  <span className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5" />
                    <span className="font-medium">Firecracker is ready!</span>
                  </span>
                  <p className="mt-2 text-[hsl(var(--text-secondary))]">
                    You can now create Firecracker microVMs from the Sandboxes page.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--bg-base))]">
          <button
            onClick={() => setStep(steps[currentStepIndex - 1]?.id)}
            disabled={currentStepIndex === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          <div className="flex items-center gap-2">
            {step !== 'verify' ? (
              <button
                onClick={() => setStep(steps[currentStepIndex + 1]?.id)}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-[hsl(var(--purple))] text-white hover:bg-[hsl(var(--purple)/0.9)]"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-[hsl(var(--green))] text-white hover:bg-[hsl(var(--green)/0.9)]"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Command block with copy button
function CommandBlock({
  command,
  id,
  copied,
  onCopy,
}: {
  command: string;
  id: string;
  copied: boolean;
  onCopy: (command: string, id: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
      <code className="flex-1 text-xs font-mono text-[hsl(var(--cyan))]">{command}</code>
      <button
        onClick={() => onCopy(command, id)}
        className={`flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors ${
          copied
            ? 'bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.3)]'
            : 'text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))]'
        }`}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

// Status check item
function StatusItem({
  label,
  success,
  detail,
}: {
  label: string;
  success: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
      {success ? (
        <CheckCircle className="h-5 w-5 text-[hsl(var(--green))]" />
      ) : (
        <XCircle className="h-5 w-5 text-[hsl(var(--red))]" />
      )}
      <div className="flex-1">
        <span className="text-xs font-medium text-[hsl(var(--text-primary))]">{label}</span>
        <span className={`ml-2 text-[10px] ${success ? 'text-[hsl(var(--green))]' : 'text-[hsl(var(--text-muted))]'}`}>
          {detail}
        </span>
      </div>
    </div>
  );
}
