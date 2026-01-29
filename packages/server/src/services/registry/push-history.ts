/**
 * Push history tracking
 *
 * Stores records of pushed images in data/push-history.json.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import { getConfig } from '../config.js';
import type { RegistryType } from './index.js';

export interface PushRecord {
  id: string;
  localImage: string;
  remoteImage: string;
  imageName: string;
  registryType: RegistryType;
  registryUrl: string;
  pushedAt: string;
}

async function getHistoryFile(): Promise<string> {
  const config = await getConfig();
  return join(config.dataDirectory, 'push-history.json');
}

async function loadHistory(): Promise<PushRecord[]> {
  const file = await getHistoryFile();
  try {
    const content = await readFile(file, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveHistory(records: PushRecord[]): Promise<void> {
  const file = await getHistoryFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(records, null, 2));
}

export async function addPushRecord(record: Omit<PushRecord, 'id'>): Promise<PushRecord> {
  const records = await loadHistory();
  const newRecord: PushRecord = { id: randomUUID(), ...record };
  records.unshift(newRecord);
  await saveHistory(records);
  return newRecord;
}

export async function listPushRecords(): Promise<PushRecord[]> {
  return loadHistory();
}

export async function deletePushRecord(id: string): Promise<boolean> {
  const records = await loadHistory();
  const index = records.findIndex(r => r.id === id);
  if (index === -1) return false;
  records.splice(index, 1);
  await saveHistory(records);
  return true;
}
