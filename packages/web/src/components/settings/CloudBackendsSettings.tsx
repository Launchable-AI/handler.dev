/**
 * CloudBackendsSettings - Cloud backend configuration (Daytona, AWS)
 */

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Cloud, ExternalLink, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';
import * as api from '../../api/client';

export function CloudBackendsSettings() {
  const queryClient = useQueryClient();

  // Daytona state
  const [daytonaApiUrl, setDaytonaApiUrl] = useState('https://app.daytona.io/api');
  const [daytonaApiKey, setDaytonaApiKey] = useState('');
  const [daytonaEnabled, setDaytonaEnabled] = useState(false);
  const [daytonaConfigured, setDaytonaConfigured] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [daytonnaSaving, setDaytonnaSaving] = useState(false);
  const [daytonaTestResult, setDaytonaTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  // AWS state
  const [awsAccessKeyId, setAwsAccessKeyId] = useState('');
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState('');
  const [awsRegion, setAwsRegion] = useState('us-east-1');
  const [awsEnabled, setAwsEnabled] = useState(false);
  const [awsConfigured, setAwsConfigured] = useState(false);
  const [awsSaving, setAwsSaving] = useState(false);
  const [awsTestResult, setAwsTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [showAwsSecretKey, setShowAwsSecretKey] = useState(false);
  const [awsRegions, setAwsRegions] = useState<{ id: string; name: string }[]>([]);

  // Loading state
  const [isLoading, setIsLoading] = useState(true);

  // Load cloud config on mount
  useEffect(() => {
    loadCloudConfig();
  }, []);

  const loadCloudConfig = async () => {
    setIsLoading(true);
    try {
      const [daytonaConfig, awsConfig, regions] = await Promise.all([
        api.getDaytonaConfig(),
        api.getAwsConfig(),
        api.listAwsRegions(),
      ]);

      // Daytona
      setDaytonaApiUrl(daytonaConfig.apiUrl || 'https://app.daytona.io/api');
      setDaytonaEnabled(daytonaConfig.enabled);
      setDaytonaConfigured(daytonaConfig.configured);
      if (!daytonaConfig.hasApiKey) {
        setDaytonaApiKey('');
      }

      // AWS
      setAwsRegion(awsConfig.region || 'us-east-1');
      setAwsEnabled(awsConfig.enabled);
      setAwsConfigured(awsConfig.configured);
      setAwsRegions(regions);
      if (!awsConfig.hasCredentials) {
        setAwsAccessKeyId('');
        setAwsSecretAccessKey('');
      }
    } catch {
      // Ignore errors - defaults are fine
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveDaytona = async () => {
    setDaytonnaSaving(true);
    setDaytonaTestResult(null);
    try {
      await api.configureDaytona({
        apiUrl: daytonaApiUrl,
        apiKey: daytonaApiKey || undefined,
        enabled: daytonaEnabled,
      });
      setDaytonaConfigured(!!daytonaApiKey);
      queryClient.invalidateQueries({ queryKey: ['backend-status'] });
    } finally {
      setDaytonnaSaving(false);
    }
  };

  const handleTestDaytona = async () => {
    setDaytonaTestResult(null);
    try {
      const result = await api.testDaytonaConnection({
        apiUrl: daytonaApiUrl,
        apiKey: daytonaApiKey || undefined,
      });
      setDaytonaTestResult(result);
    } catch (err) {
      setDaytonaTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection failed' });
    }
  };

  const handleSaveAws = async () => {
    setAwsSaving(true);
    setAwsTestResult(null);
    try {
      await api.configureAws({
        accessKeyId: awsAccessKeyId || undefined,
        secretAccessKey: awsSecretAccessKey || undefined,
        region: awsRegion,
        enabled: awsEnabled,
      });
      setAwsConfigured(!!(awsAccessKeyId && awsSecretAccessKey));
      queryClient.invalidateQueries({ queryKey: ['backend-status'] });
    } finally {
      setAwsSaving(false);
    }
  };

  const handleTestAws = async () => {
    setAwsTestResult(null);
    try {
      const result = await api.testAwsConnection({
        accessKeyId: awsAccessKeyId || undefined,
        secretAccessKey: awsSecretAccessKey || undefined,
        region: awsRegion,
      });
      setAwsTestResult(result);
    } catch (err) {
      setAwsTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection failed' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--text-muted))]" />
      </div>
    );
  }

  return (
    <>
      <div>
        <h3 className="text-sm font-medium text-[hsl(var(--text-primary))]">Cloud Backends</h3>
        <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1">
          Configure cloud-based compute backends for running workspaces remotely
        </p>
      </div>

      {/* Daytona Configuration */}
      <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
            <Cloud className="h-5 w-5 text-[hsl(var(--amber))]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">Daytona</h4>
              {daytonaConfigured && (
                <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">
                  Configured
                </span>
              )}
            </div>
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
              Standardized development environments powered by Daytona.io
            </p>
            <a
              href="https://www.daytona.io"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--amber))] hover:underline mt-1"
            >
              Learn more <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={daytonaEnabled}
              onChange={(e) => setDaytonaEnabled(e.target.checked)}
              disabled={!daytonaConfigured}
              className="w-4 h-4 accent-[hsl(var(--amber))]"
            />
            <span className="text-xs text-[hsl(var(--text-secondary))]">Enabled</span>
          </label>
        </div>

        <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
          {/* API URL */}
          <div>
            <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">
              API URL
            </label>
            <input
              type="text"
              value={daytonaApiUrl}
              onChange={(e) => setDaytonaApiUrl(e.target.value)}
              placeholder="https://app.daytona.io/api"
              className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">
              API Key
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={daytonaApiKey}
                onChange={(e) => setDaytonaApiKey(e.target.value)}
                placeholder={daytonaConfigured ? '••••••••••••••••' : 'Enter your Daytona API key'}
                className="w-full px-3 py-2 pr-10 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1.5">
              Get your API key from the Daytona dashboard
            </p>
          </div>

          {/* Test Result */}
          {daytonaTestResult && (
            <div className={`p-3 text-xs ${
              daytonaTestResult.success
                ? 'bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-[hsl(var(--green))]'
                : 'bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-[hsl(var(--red))]'
            }`}>
              {daytonaTestResult.success ? (
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="h-4 w-4" />
                  {daytonaTestResult.message || 'Connection successful'}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <XCircle className="h-4 w-4" />
                  {daytonaTestResult.error || 'Connection failed'}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleTestDaytona}
              disabled={!daytonaApiKey || daytonnaSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50"
            >
              Test Connection
            </button>
            <button
              onClick={handleSaveDaytona}
              disabled={daytonnaSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--amber))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--amber)/0.9)] disabled:opacity-50"
            >
              {daytonnaSaving && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>

      {/* AWS Configuration */}
      <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
            <Cloud className="h-5 w-5 text-[hsl(var(--orange))]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">AWS EC2</h4>
              {awsConfigured && (
                <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">
                  Configured
                </span>
              )}
            </div>
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">
              EC2 Spot instances with persistent EBS volumes for cost-effective cloud sandboxes.
            </p>
            <a
              href="https://aws.amazon.com/ec2/spot/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--orange))] hover:underline mt-1"
            >
              Learn more <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={awsEnabled}
              onChange={(e) => setAwsEnabled(e.target.checked)}
              disabled={!awsConfigured}
              className="w-4 h-4 accent-[hsl(var(--orange))]"
            />
            <span className="text-xs text-[hsl(var(--text-secondary))]">Enabled</span>
          </label>
        </div>

        <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
          {/* Region */}
          <div>
            <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">
              Region
            </label>
            <select
              value={awsRegion}
              onChange={(e) => setAwsRegion(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]"
            >
              {awsRegions.length > 0 ? (
                awsRegions.map((region) => (
                  <option key={region.id} value={region.id}>
                    {region.name} ({region.id})
                  </option>
                ))
              ) : (
                <>
                  <option value="us-east-1">US East (N. Virginia) (us-east-1)</option>
                  <option value="us-west-2">US West (Oregon) (us-west-2)</option>
                  <option value="eu-west-1">EU (Ireland) (eu-west-1)</option>
                </>
              )}
            </select>
          </div>

          {/* Access Key ID */}
          <div>
            <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">
              Access Key ID
            </label>
            <input
              type="text"
              value={awsAccessKeyId}
              onChange={(e) => setAwsAccessKeyId(e.target.value)}
              placeholder={awsConfigured ? '••••••••••••••••' : 'AKIA...'}
              className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
            />
          </div>

          {/* Secret Access Key */}
          <div>
            <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">
              Secret Access Key
            </label>
            <div className="relative">
              <input
                type={showAwsSecretKey ? 'text' : 'password'}
                value={awsSecretAccessKey}
                onChange={(e) => setAwsSecretAccessKey(e.target.value)}
                placeholder={awsConfigured ? '••••••••••••••••' : 'Enter your AWS Secret Access Key'}
                className="w-full px-3 py-2 pr-10 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]"
              />
              <button
                type="button"
                onClick={() => setShowAwsSecretKey(!showAwsSecretKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]"
              >
                {showAwsSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1.5">
              Get credentials from the AWS IAM console
            </p>
          </div>

          {/* Test Result */}
          {awsTestResult && (
            <div className={`p-3 text-xs ${
              awsTestResult.success
                ? 'bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-[hsl(var(--green))]'
                : 'bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-[hsl(var(--red))]'
            }`}>
              {awsTestResult.success ? (
                <span className="flex items-center gap-1.5">
                  <CheckCircle className="h-4 w-4" />
                  {awsTestResult.message || 'Connection successful'}
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <XCircle className="h-4 w-4" />
                  {awsTestResult.error || 'Connection failed'}
                </span>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleTestAws}
              disabled={(!awsAccessKeyId || !awsSecretAccessKey) || awsSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50"
            >
              Test Connection
            </button>
            <button
              onClick={handleSaveAws}
              disabled={awsSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--orange))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--orange)/0.9)] disabled:opacity-50"
            >
              {awsSaving && <Loader2 className="h-3 w-3 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Info section */}
      <div className="p-4 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))] space-y-3">
        <h4 className="text-xs font-medium text-[hsl(var(--text-primary))] uppercase tracking-wider">About Cloud Backends</h4>
        <div className="space-y-2 text-[10px] text-[hsl(var(--text-muted))]">
          <p>
            <strong className="text-[hsl(var(--amber))]">Daytona</strong>: Cloud-based development environments with full IDE support.
            Create standardized, reproducible workspaces from any Git repository.
          </p>
          <p>
            <strong className="text-[hsl(var(--orange))]">AWS EC2</strong>: Cost-effective Spot instances in your own AWS account.
            Persistent EBS volumes preserve state across stop/start cycles.
          </p>
          <p>
            Cloud backends appear as additional options when creating new sandboxes, alongside local hypervisors.
            They&apos;re ideal for remote development and team collaboration.
          </p>
        </div>
      </div>
    </>
  );
}
