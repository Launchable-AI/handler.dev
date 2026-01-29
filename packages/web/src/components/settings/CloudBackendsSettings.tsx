/**
 * CloudBackendsSettings - Cloud backend configuration (Daytona, AWS, Azure, GCP, DigitalOcean, Linode)
 */

import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, ExternalLink, Eye, EyeOff, CheckCircle, XCircle } from 'lucide-react';
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

  // Azure state
  const [azureClientId, setAzureClientId] = useState('');
  const [azureClientSecret, setAzureClientSecret] = useState('');
  const [azureTenantId, setAzureTenantId] = useState('');
  const [azureSubscriptionId, setAzureSubscriptionId] = useState('');
  const [azureRegion, setAzureRegion] = useState('eastus');
  const [azureResourceGroup, setAzureResourceGroup] = useState('');
  const [azureEnabled, setAzureEnabled] = useState(false);
  const [azureConfigured, setAzureConfigured] = useState(false);
  const [azureSaving, setAzureSaving] = useState(false);
  const [azureTestResult, setAzureTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [showAzureClientSecret, setShowAzureClientSecret] = useState(false);

  // GCP state
  const [gcpProjectId, setGcpProjectId] = useState('');
  const [gcpKeyFileJson, setGcpKeyFileJson] = useState('');
  const [gcpZone, setGcpZone] = useState('us-central1-a');
  const [gcpEnabled, setGcpEnabled] = useState(false);
  const [gcpConfigured, setGcpConfigured] = useState(false);
  const [gcpSaving, setGcpSaving] = useState(false);
  const [gcpTestResult, setGcpTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [showGcpKeyFile, setShowGcpKeyFile] = useState(false);

  // DigitalOcean state
  const [doApiToken, setDoApiToken] = useState('');
  const [doRegion, setDoRegion] = useState('nyc1');
  const [doEnabled, setDoEnabled] = useState(false);
  const [doConfigured, setDoConfigured] = useState(false);
  const [doSaving, setDoSaving] = useState(false);
  const [doTestResult, setDoTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [showDoApiToken, setShowDoApiToken] = useState(false);

  // Linode state
  const [linodeApiToken, setLinodeApiToken] = useState('');
  const [linodeRegion, setLinodeRegion] = useState('us-east');
  const [linodeEnabled, setLinodeEnabled] = useState(false);
  const [linodeConfigured, setLinodeConfigured] = useState(false);
  const [linodeSaving, setLinodeSaving] = useState(false);
  const [linodeTestResult, setLinodeTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);
  const [showLinodeApiToken, setShowLinodeApiToken] = useState(false);

  // Loading state
  const [isLoading, setIsLoading] = useState(true);



  // Load cloud config on mount
  useEffect(() => {
    loadCloudConfig();
  }, []);

  const loadCloudConfig = async () => {
    setIsLoading(true);
    try {
      const [daytonaConfig, awsConfig, regions, azureConfig, gcpConfig, doConfig, linodeConfig] = await Promise.all([
        api.getDaytonaConfig(),
        api.getAwsConfig(),
        api.listAwsRegions(),
        api.getAzureConfig().catch(() => null),
        api.getGcpConfig().catch(() => null),
        api.getDigitalOceanConfig().catch(() => null),
        api.getLinodeConfig().catch(() => null),
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

      // Azure
      if (azureConfig) {
        setAzureRegion(azureConfig.region || 'eastus');
        setAzureResourceGroup(azureConfig.resourceGroup || '');
        setAzureEnabled(azureConfig.enabled);
        setAzureConfigured(azureConfig.configured);
        if (!azureConfig.hasCredentials) {
          setAzureClientId('');
          setAzureClientSecret('');
          setAzureTenantId('');
          setAzureSubscriptionId('');
        }
      }

      // GCP
      if (gcpConfig) {
        setGcpProjectId(gcpConfig.projectId || '');
        setGcpZone(gcpConfig.zone || 'us-central1-a');
        setGcpEnabled(gcpConfig.enabled);
        setGcpConfigured(gcpConfig.configured);
        if (!gcpConfig.hasCredentials) {
          setGcpKeyFileJson('');
        }
      }

      // DigitalOcean
      if (doConfig) {
        setDoRegion(doConfig.region || 'nyc1');
        setDoEnabled(doConfig.enabled);
        setDoConfigured(doConfig.configured);
        if (!doConfig.hasCredentials) {
          setDoApiToken('');
        }
      }

      // Linode
      if (linodeConfig) {
        setLinodeRegion(linodeConfig.region || 'us-east');
        setLinodeEnabled(linodeConfig.enabled);
        setLinodeConfigured(linodeConfig.configured);
        if (!linodeConfig.hasCredentials) {
          setLinodeApiToken('');
        }
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

  // Azure handlers
  const handleSaveAzure = async () => {
    setAzureSaving(true);
    setAzureTestResult(null);
    try {
      await api.configureAzure({
        clientId: azureClientId || undefined,
        clientSecret: azureClientSecret || undefined,
        tenantId: azureTenantId || undefined,
        subscriptionId: azureSubscriptionId || undefined,
        region: azureRegion,
        resourceGroup: azureResourceGroup || undefined,
        enabled: azureEnabled,
      });
      setAzureConfigured(!!(azureClientId && azureClientSecret && azureTenantId && azureSubscriptionId));
      queryClient.invalidateQueries({ queryKey: ['backend-status'] });
    } finally {
      setAzureSaving(false);
    }
  };

  const handleTestAzure = async () => {
    setAzureTestResult(null);
    try {
      const result = await api.testAzureConnection({
        clientId: azureClientId || undefined,
        clientSecret: azureClientSecret || undefined,
        tenantId: azureTenantId || undefined,
        subscriptionId: azureSubscriptionId || undefined,
        region: azureRegion,
      });
      setAzureTestResult(result);
    } catch (err) {
      setAzureTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection failed' });
    }
  };

  // GCP handlers
  const handleSaveGcp = async () => {
    setGcpSaving(true);
    setGcpTestResult(null);
    try {
      await api.configureGcp({
        projectId: gcpProjectId || undefined,
        keyFileJson: gcpKeyFileJson || undefined,
        zone: gcpZone,
        enabled: gcpEnabled,
      });
      setGcpConfigured(!!(gcpProjectId && gcpKeyFileJson));
      queryClient.invalidateQueries({ queryKey: ['backend-status'] });
    } finally {
      setGcpSaving(false);
    }
  };

  const handleTestGcp = async () => {
    setGcpTestResult(null);
    try {
      const result = await api.testGcpConnection({
        projectId: gcpProjectId || undefined,
        keyFileJson: gcpKeyFileJson || undefined,
        zone: gcpZone,
      });
      setGcpTestResult(result);
    } catch (err) {
      setGcpTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection failed' });
    }
  };

  // DigitalOcean handlers
  const handleSaveDigitalOcean = async () => {
    setDoSaving(true);
    setDoTestResult(null);
    try {
      await api.configureDigitalOcean({
        apiToken: doApiToken || undefined,
        region: doRegion,
        enabled: doEnabled,
      });
      setDoConfigured(!!doApiToken);
      queryClient.invalidateQueries({ queryKey: ['backend-status'] });
    } finally {
      setDoSaving(false);
    }
  };

  const handleTestDigitalOcean = async () => {
    setDoTestResult(null);
    try {
      const result = await api.testDigitalOceanConnection({
        apiToken: doApiToken || undefined,
        region: doRegion,
      });
      setDoTestResult(result);
    } catch (err) {
      setDoTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection failed' });
    }
  };

  // Linode handlers
  const handleSaveLinode = async () => {
    setLinodeSaving(true);
    setLinodeTestResult(null);
    try {
      await api.configureLinode({
        apiToken: linodeApiToken || undefined,
        region: linodeRegion,
        enabled: linodeEnabled,
      });
      setLinodeConfigured(!!linodeApiToken);
      queryClient.invalidateQueries({ queryKey: ['backend-status'] });
    } finally {
      setLinodeSaving(false);
    }
  };

  const handleTestLinode = async () => {
    setLinodeTestResult(null);
    try {
      const result = await api.testLinodeConnection({
        apiToken: linodeApiToken || undefined,
        region: linodeRegion,
      });
      setLinodeTestResult(result);
    } catch (err) {
      setLinodeTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection failed' });
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

      {/* All backend cards in a horizontal wrapping grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">

        {/* Daytona */}
        <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
              <img src="/backends/daytona.ico" alt="Daytona" className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">Daytona</h4>
                {daytonaConfigured && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">Configured</span>
                )}
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">Standardized development environments powered by Daytona.io</p>
              <div className="flex items-center gap-2 mt-1">
                <a href="https://www.daytona.io/docs/installation/installation/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--amber))] hover:underline">Sign up</a>
                <a href="https://app.daytona.io" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--amber))] hover:underline">Login</a>
                <a href="https://www.daytona.io" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--text-muted))] hover:underline">Docs <ExternalLink className="h-2.5 w-2.5" /></a>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={daytonaEnabled} onChange={(e) => setDaytonaEnabled(e.target.checked)} disabled={!daytonaConfigured} className="w-4 h-4 accent-[hsl(var(--amber))]" />
              <span className="text-xs text-[hsl(var(--text-secondary))]">Enabled</span>
            </label>
          </div>
          <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">API URL</label>
              <input type="text" value={daytonaApiUrl} onChange={(e) => setDaytonaApiUrl(e.target.value)} placeholder="https://app.daytona.io/api" className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">API Key</label>
              <div className="relative">
                <input type={showApiKey ? 'text' : 'password'} value={daytonaApiKey} onChange={(e) => setDaytonaApiKey(e.target.value)} placeholder={daytonaConfigured ? '••••••••••••••••' : 'Enter your Daytona API key'} className="w-full px-3 py-2 pr-10 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1.5">Get your API key from the Daytona dashboard</p>
            </div>
            {daytonaTestResult && (
              <div className={`p-3 text-xs ${daytonaTestResult.success ? 'bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-[hsl(var(--green))]' : 'bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-[hsl(var(--red))]'}`}>
                {daytonaTestResult.success ? (<span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4" />{daytonaTestResult.message || 'Connection successful'}</span>) : (<span className="flex items-center gap-1.5"><XCircle className="h-4 w-4" />{daytonaTestResult.error || 'Connection failed'}</span>)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button onClick={handleTestDaytona} disabled={!daytonaApiKey || daytonnaSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50">Test Connection</button>
              <button onClick={handleSaveDaytona} disabled={daytonnaSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--amber))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--amber)/0.9)] disabled:opacity-50">
                {daytonnaSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>

        {/* AWS EC2 */}
        <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
              <img src="/backends/aws.ico" alt="AWS" className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">AWS EC2</h4>
                {awsConfigured && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">Configured</span>
                )}
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">EC2 Spot instances with persistent EBS volumes.</p>
              <div className="flex items-center gap-2 mt-1">
                <a href="https://aws.amazon.com/premiumsupport/knowledge-center/create-and-activate-aws-account/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--orange))] hover:underline">Sign up</a>
                <a href="https://console.aws.amazon.com" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--orange))] hover:underline">Login</a>
                <a href="https://aws.amazon.com/ec2/spot/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--text-muted))] hover:underline">Docs <ExternalLink className="h-2.5 w-2.5" /></a>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={awsEnabled} onChange={(e) => setAwsEnabled(e.target.checked)} disabled={!awsConfigured} className="w-4 h-4 accent-[hsl(var(--orange))]" />
              <span className="text-xs text-[hsl(var(--text-secondary))]">Enabled</span>
            </label>
          </div>
          <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Region</label>
              <select value={awsRegion} onChange={(e) => setAwsRegion(e.target.value)} className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))]">
                {awsRegions.length > 0 ? awsRegions.map((region) => (<option key={region.id} value={region.id}>{region.name} ({region.id})</option>)) : (<><option value="us-east-1">US East (N. Virginia) (us-east-1)</option><option value="us-west-2">US West (Oregon) (us-west-2)</option><option value="eu-west-1">EU (Ireland) (eu-west-1)</option></>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Access Key ID</label>
              <input type="text" value={awsAccessKeyId} onChange={(e) => setAwsAccessKeyId(e.target.value)} placeholder={awsConfigured ? '••••••••••••••••' : 'AKIA...'} className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Secret Access Key</label>
              <div className="relative">
                <input type={showAwsSecretKey ? 'text' : 'password'} value={awsSecretAccessKey} onChange={(e) => setAwsSecretAccessKey(e.target.value)} placeholder={awsConfigured ? '••••••••••••••••' : 'Enter your AWS Secret Access Key'} className="w-full px-3 py-2 pr-10 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
                <button type="button" onClick={() => setShowAwsSecretKey(!showAwsSecretKey)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
                  {showAwsSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1.5">Get credentials from the AWS IAM console</p>
            </div>
            {awsTestResult && (
              <div className={`p-3 text-xs ${awsTestResult.success ? 'bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-[hsl(var(--green))]' : 'bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-[hsl(var(--red))]'}`}>
                {awsTestResult.success ? (<span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4" />{awsTestResult.message || 'Connection successful'}</span>) : (<span className="flex items-center gap-1.5"><XCircle className="h-4 w-4" />{awsTestResult.error || 'Connection failed'}</span>)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button onClick={handleTestAws} disabled={(!awsAccessKeyId || !awsSecretAccessKey) || awsSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50">Test Connection</button>
              <button onClick={handleSaveAws} disabled={awsSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--orange))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--orange)/0.9)] disabled:opacity-50">
                {awsSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>

        {/* Azure VM */}
        <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
              <img src="/backends/microsoft.ico" alt="Azure" className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">Azure VM</h4>
                {azureConfigured && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">Configured</span>
                )}
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">Azure Virtual Machines with managed disks and VNet isolation.</p>
              <div className="flex items-center gap-2 mt-1">
                <a href="https://azure.microsoft.com/en-us/free/" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--cyan))] hover:underline">Sign up</a>
                <a href="https://portal.azure.com" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--cyan))] hover:underline">Login</a>
                <a href="https://azure.microsoft.com/en-us/products/virtual-machines" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--text-muted))] hover:underline">Docs <ExternalLink className="h-2.5 w-2.5" /></a>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={azureEnabled} onChange={(e) => setAzureEnabled(e.target.checked)} disabled={!azureConfigured} className="w-4 h-4 accent-[hsl(var(--cyan))]" />
              <span className="text-xs text-[hsl(var(--text-secondary))]">Enabled</span>
            </label>
          </div>
          <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Tenant ID</label>
              <input type="text" value={azureTenantId} onChange={(e) => setAzureTenantId(e.target.value)} placeholder={azureConfigured ? '••••••••••••••••' : 'Enter your Azure Tenant ID'} className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Subscription ID</label>
              <input type="text" value={azureSubscriptionId} onChange={(e) => setAzureSubscriptionId(e.target.value)} placeholder={azureConfigured ? '••••••••••••••••' : 'Enter your Azure Subscription ID'} className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Client ID (App ID)</label>
              <input type="text" value={azureClientId} onChange={(e) => setAzureClientId(e.target.value)} placeholder={azureConfigured ? '••••••••••••••••' : 'Enter your Azure Client ID'} className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Client Secret</label>
              <div className="relative">
                <input type={showAzureClientSecret ? 'text' : 'password'} value={azureClientSecret} onChange={(e) => setAzureClientSecret(e.target.value)} placeholder={azureConfigured ? '••••••••••••••••' : 'Enter your Azure Client Secret'} className="w-full px-3 py-2 pr-10 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
                <button type="button" onClick={() => setShowAzureClientSecret(!showAzureClientSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
                  {showAzureClientSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Region</label>
              <input type="text" value={azureRegion} onChange={(e) => setAzureRegion(e.target.value)} placeholder="eastus" className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Resource Group</label>
              <input type="text" value={azureResourceGroup} onChange={(e) => setAzureResourceGroup(e.target.value)} placeholder="my-resource-group" className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1.5">Get credentials from Azure Active Directory app registrations</p>
            </div>
            {azureTestResult && (
              <div className={`p-3 text-xs ${azureTestResult.success ? 'bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-[hsl(var(--green))]' : 'bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-[hsl(var(--red))]'}`}>
                {azureTestResult.success ? (<span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4" />{azureTestResult.message || 'Connection successful'}</span>) : (<span className="flex items-center gap-1.5"><XCircle className="h-4 w-4" />{azureTestResult.error || 'Connection failed'}</span>)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button onClick={handleTestAzure} disabled={(!azureClientId || !azureClientSecret || !azureTenantId || !azureSubscriptionId) || azureSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50">Test Connection</button>
              <button onClick={handleSaveAzure} disabled={azureSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--cyan))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--cyan)/0.9)] disabled:opacity-50">
                {azureSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>

        {/* Google Cloud */}
        <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
              <img src="/backends/gcp.ico" alt="Google Cloud" className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">Google Cloud</h4>
                {gcpConfigured && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">Configured</span>
                )}
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">GCP Compute Engine instances with persistent disk storage.</p>
              <div className="flex items-center gap-2 mt-1">
                <a href="https://cloud.google.com/free" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--green))] hover:underline">Sign up</a>
                <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--green))] hover:underline">Login</a>
                <a href="https://cloud.google.com/compute" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--text-muted))] hover:underline">Docs <ExternalLink className="h-2.5 w-2.5" /></a>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={gcpEnabled} onChange={(e) => setGcpEnabled(e.target.checked)} disabled={!gcpConfigured} className="w-4 h-4 accent-[hsl(var(--green))]" />
              <span className="text-xs text-[hsl(var(--text-secondary))]">Enabled</span>
            </label>
          </div>
          <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Project ID</label>
              <input type="text" value={gcpProjectId} onChange={(e) => setGcpProjectId(e.target.value)} placeholder="my-gcp-project" className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Zone</label>
              <input type="text" value={gcpZone} onChange={(e) => setGcpZone(e.target.value)} placeholder="us-central1-a" className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Service Account Key (JSON)</label>
              <div className="relative">
                <textarea value={gcpKeyFileJson} onChange={(e) => setGcpKeyFileJson(e.target.value)} placeholder={gcpConfigured ? '••••••••••••••••' : 'Paste your service account JSON key content'} rows={4} className={`w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))] font-mono resize-y ${!showGcpKeyFile && gcpKeyFileJson ? 'text-transparent' : ''}`} style={!showGcpKeyFile && gcpKeyFileJson ? { caretColor: 'hsl(var(--text-primary))' } : undefined} />
                <button type="button" onClick={() => setShowGcpKeyFile(!showGcpKeyFile)} className="absolute right-2 top-2 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
                  {showGcpKeyFile ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1.5">Create a service account key from the GCP IAM console</p>
            </div>
            {gcpTestResult && (
              <div className={`p-3 text-xs ${gcpTestResult.success ? 'bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-[hsl(var(--green))]' : 'bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-[hsl(var(--red))]'}`}>
                {gcpTestResult.success ? (<span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4" />{gcpTestResult.message || 'Connection successful'}</span>) : (<span className="flex items-center gap-1.5"><XCircle className="h-4 w-4" />{gcpTestResult.error || 'Connection failed'}</span>)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button onClick={handleTestGcp} disabled={(!gcpProjectId || !gcpKeyFileJson) || gcpSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50">Test Connection</button>
              <button onClick={handleSaveGcp} disabled={gcpSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50">
                {gcpSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>

        {/* DigitalOcean */}
        <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
              <img src="/backends/digital_ocean.ico" alt="DigitalOcean" className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">DigitalOcean</h4>
                {doConfigured && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">Configured</span>
                )}
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">DigitalOcean Droplets with block storage volumes.</p>
              <div className="flex items-center gap-2 mt-1">
                <a href="https://cloud.digitalocean.com/registrations/new" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--purple))] hover:underline">Sign up</a>
                <a href="https://cloud.digitalocean.com/login" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--purple))] hover:underline">Login</a>
                <a href="https://www.digitalocean.com/products/droplets" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--text-muted))] hover:underline">Docs <ExternalLink className="h-2.5 w-2.5" /></a>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={doEnabled} onChange={(e) => setDoEnabled(e.target.checked)} disabled={!doConfigured} className="w-4 h-4 accent-[hsl(var(--purple))]" />
              <span className="text-xs text-[hsl(var(--text-secondary))]">Enabled</span>
            </label>
          </div>
          <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Region</label>
              <input type="text" value={doRegion} onChange={(e) => setDoRegion(e.target.value)} placeholder="nyc1" className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">API Token</label>
              <div className="relative">
                <input type={showDoApiToken ? 'text' : 'password'} value={doApiToken} onChange={(e) => setDoApiToken(e.target.value)} placeholder={doConfigured ? '••••••••••••••••' : 'Enter your DigitalOcean API token'} className="w-full px-3 py-2 pr-10 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
                <button type="button" onClick={() => setShowDoApiToken(!showDoApiToken)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
                  {showDoApiToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1.5">Generate a personal access token from the DigitalOcean API settings</p>
            </div>
            {doTestResult && (
              <div className={`p-3 text-xs ${doTestResult.success ? 'bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-[hsl(var(--green))]' : 'bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-[hsl(var(--red))]'}`}>
                {doTestResult.success ? (<span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4" />{doTestResult.message || 'Connection successful'}</span>) : (<span className="flex items-center gap-1.5"><XCircle className="h-4 w-4" />{doTestResult.error || 'Connection failed'}</span>)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button onClick={handleTestDigitalOcean} disabled={!doApiToken || doSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50">Test Connection</button>
              <button onClick={handleSaveDigitalOcean} disabled={doSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--purple))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--purple)/0.9)] disabled:opacity-50">
                {doSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>

        {/* Linode */}
        <div className="p-4 bg-[hsl(var(--bg-surface))] border border-[hsl(var(--border))] space-y-4">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-[hsl(var(--bg-base))] border border-[hsl(var(--border))]">
              <img src="/backends/linode.ico" alt="Linode" className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-medium text-[hsl(var(--text-primary))]">Linode</h4>
                {linodeConfigured && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-[hsl(var(--green)/0.1)] text-[hsl(var(--green))] border border-[hsl(var(--green)/0.2)]">Configured</span>
                )}
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-0.5">Linode instances with dedicated CPU and SSD storage.</p>
              <div className="flex items-center gap-2 mt-1">
                <a href="https://login.linode.com/signup" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--green))] hover:underline">Sign up</a>
                <a href="https://cloud.linode.com" target="_blank" rel="noopener noreferrer" className="text-[10px] text-[hsl(var(--green))] hover:underline">Login</a>
                <a href="https://www.linode.com/products/dedicated-cpu/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10px] text-[hsl(var(--text-muted))] hover:underline">Docs <ExternalLink className="h-2.5 w-2.5" /></a>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={linodeEnabled} onChange={(e) => setLinodeEnabled(e.target.checked)} disabled={!linodeConfigured} className="w-4 h-4 accent-[hsl(var(--green))]" />
              <span className="text-xs text-[hsl(var(--text-secondary))]">Enabled</span>
            </label>
          </div>
          <div className="space-y-3 pt-3 border-t border-[hsl(var(--border))]">
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">Region</label>
              <input type="text" value={linodeRegion} onChange={(e) => setLinodeRegion(e.target.value)} placeholder="us-east" className="w-full px-3 py-2 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
            </div>
            <div>
              <label className="text-xs font-medium text-[hsl(var(--text-primary))] mb-1.5 block">API Token</label>
              <div className="relative">
                <input type={showLinodeApiToken ? 'text' : 'password'} value={linodeApiToken} onChange={(e) => setLinodeApiToken(e.target.value)} placeholder={linodeConfigured ? '••••••••••••••••' : 'Enter your Linode API token'} className="w-full px-3 py-2 pr-10 text-xs bg-[hsl(var(--input-bg))] border border-[hsl(var(--border))] text-[hsl(var(--text-primary))] placeholder:text-[hsl(var(--text-muted))]" />
                <button type="button" onClick={() => setShowLinodeApiToken(!showLinodeApiToken)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[hsl(var(--text-muted))] hover:text-[hsl(var(--text-primary))]">
                  {showLinodeApiToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[10px] text-[hsl(var(--text-muted))] mt-1.5">Generate a personal access token from the Linode Cloud Manager</p>
            </div>
            {linodeTestResult && (
              <div className={`p-3 text-xs ${linodeTestResult.success ? 'bg-[hsl(var(--green)/0.1)] border border-[hsl(var(--green)/0.2)] text-[hsl(var(--green))]' : 'bg-[hsl(var(--red)/0.1)] border border-[hsl(var(--red)/0.2)] text-[hsl(var(--red))]'}`}>
                {linodeTestResult.success ? (<span className="flex items-center gap-1.5"><CheckCircle className="h-4 w-4" />{linodeTestResult.message || 'Connection successful'}</span>) : (<span className="flex items-center gap-1.5"><XCircle className="h-4 w-4" />{linodeTestResult.error || 'Connection failed'}</span>)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button onClick={handleTestLinode} disabled={!linodeApiToken || linodeSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[hsl(var(--text-secondary))] hover:text-[hsl(var(--text-primary))] hover:bg-[hsl(var(--bg-elevated))] border border-[hsl(var(--border))] disabled:opacity-50">Test Connection</button>
              <button onClick={handleSaveLinode} disabled={linodeSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[hsl(var(--green))] text-[hsl(var(--bg-base))] hover:bg-[hsl(var(--green)/0.9)] disabled:opacity-50">
                {linodeSaving && <Loader2 className="h-3 w-3 animate-spin" />}
                Save
              </button>
            </div>
          </div>
        </div>

      </div>
    </>
  );
}
