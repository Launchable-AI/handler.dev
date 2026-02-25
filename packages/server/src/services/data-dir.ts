/**
 * Dynamic Data Directory Resolution
 *
 * Provides helpers that resolve data paths using the configured dataDirectory
 * from config.json, falling back to the static DATA_DIR default.
 *
 * config.json itself always lives at {default DATA_DIR}/config.json —
 * it's the bootstrap file that tells us where everything else lives.
 */

import { join } from 'path';
import { readdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { DATA_DIR } from '../lib/paths.js';
import { getConfig } from './config.js';

/**
 * Returns the current data directory from config, or the static default.
 */
export async function getDataDir(): Promise<string> {
  const config = await getConfig();
  return config.dataDirectory || DATA_DIR;
}

/**
 * Joins path segments onto the current data directory.
 */
export async function getDataPath(...segments: string[]): Promise<string> {
  const dataDir = await getDataDir();
  return join(dataDir, ...segments);
}

// ============ Scan Result ============

export interface DataDirScanResult {
  path: string;
  quickFiles: number;
  notes: number;
  agentConfigs: number;
  templates: number;
  dockerfiles: number;
  terminalSessions: number;
  sshKeysExist: boolean;
  isEmpty: boolean;
}

/**
 * Scan a data directory and return counts of what was found.
 */
async function scanDataDir(dataDir: string): Promise<DataDirScanResult> {
  const result: DataDirScanResult = {
    path: dataDir,
    quickFiles: 0,
    notes: 0,
    agentConfigs: 0,
    templates: 0,
    dockerfiles: 0,
    terminalSessions: 0,
    sshKeysExist: false,
    isEmpty: true,
  };

  try {
    // Count quick files
    const qfPath = join(dataDir, 'quick-files.json');
    if (existsSync(qfPath)) {
      const data = JSON.parse(await readFile(qfPath, 'utf-8'));
      result.quickFiles = data.files?.length || 0;
    }
  } catch { /* ignore */ }

  try {
    // Count notes
    const notesPath = join(dataDir, 'notes.json');
    if (existsSync(notesPath)) {
      const data = JSON.parse(await readFile(notesPath, 'utf-8'));
      result.notes = data.notes?.length || 0;
    }
  } catch { /* ignore */ }

  try {
    // Count agent configs
    const acPath = join(dataDir, 'agent-configs.json');
    if (existsSync(acPath)) {
      const data = JSON.parse(await readFile(acPath, 'utf-8'));
      result.agentConfigs = data.configs?.length || 0;
    }
  } catch { /* ignore */ }

  try {
    // Count templates
    const templatesDir = join(dataDir, 'templates');
    if (existsSync(templatesDir)) {
      const entries = await readdir(templatesDir, { withFileTypes: true });
      result.templates = entries.filter(e => e.isDirectory()).length;
    }
  } catch { /* ignore */ }

  try {
    // Count dockerfiles
    const dockerfilesDir = join(dataDir, 'dockerfiles');
    if (existsSync(dockerfilesDir)) {
      const entries = await readdir(dockerfilesDir);
      result.dockerfiles = entries.filter(f => f.endsWith('.dockerfile')).length;
    }
  } catch { /* ignore */ }

  try {
    // Count terminal sessions
    const sessionsPath = join(dataDir, 'terminal-sessions.json');
    if (existsSync(sessionsPath)) {
      const data = JSON.parse(await readFile(sessionsPath, 'utf-8'));
      result.terminalSessions = Object.keys(data).length;
    }
  } catch { /* ignore */ }

  try {
    // Check SSH keys
    const sshKeyPath = join(dataDir, 'ssh-keys', 'id_ed25519');
    result.sshKeysExist = existsSync(sshKeyPath);
  } catch { /* ignore */ }

  result.isEmpty = (
    result.quickFiles === 0 &&
    result.notes === 0 &&
    result.agentConfigs === 0 &&
    result.templates === 0 &&
    result.dockerfiles === 0 &&
    result.terminalSessions === 0 &&
    !result.sshKeysExist
  );

  return result;
}

/**
 * Reload all services after data directory changes.
 * Clears in-memory caches so services read from the new location.
 * Returns a scan of what was found in the new directory.
 */
export async function reloadServices(newDataDir: string): Promise<DataDirScanResult> {
  // Import reset functions from each service
  const { resetQuickFilesCache } = await import('./quick-files.js');
  const { resetNotesCache } = await import('./notes.js');
  const { resetAgentConfigsCache } = await import('./agent-config.js');
  const { resetSessionStoreCache } = await import('./session-store.js');
  const { resetTemplateService } = await import('./template/index.js');
  const { resetVmVolumeService } = await import('./vm-volumes.js');
  const { resetMarketplaceCache } = await import('../routes/agent-config.js');

  // Clear all caches
  resetQuickFilesCache();
  resetNotesCache();
  resetAgentConfigsCache();
  resetSessionStoreCache(newDataDir);
  resetTemplateService();
  resetVmVolumeService();
  resetMarketplaceCache();

  // Scan the new directory
  return scanDataDir(newDataDir);
}
