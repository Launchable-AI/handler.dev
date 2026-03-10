import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { getDataPath } from './data-dir.js';

export interface QuickFile {
  id: string;
  name: string;
  filename: string;
  destPath: string;
  content: string;
  isDefault: boolean;
  isSensitive?: boolean;
  createdAt: string;
  updatedAt: string;
}

async function getDataFile() {
  return getDataPath('quick-files.json');
}

interface QuickFilesData {
  files: QuickFile[];
}

const DEFAULT_DATA: QuickFilesData = {
  files: [],
};

let cachedData: QuickFilesData | null = null;

async function loadData(): Promise<QuickFilesData> {
  if (cachedData) {
    return cachedData;
  }

  try {
    const dataFile = await getDataFile();
    const content = await readFile(dataFile, 'utf-8');
    cachedData = JSON.parse(content) as QuickFilesData;
    return cachedData;
  } catch {
    return DEFAULT_DATA;
  }
}

async function saveData(data: QuickFilesData): Promise<void> {
  const dataFile = await getDataFile();
  await mkdir(dirname(dataFile), { recursive: true });
  await writeFile(dataFile, JSON.stringify(data, null, 2));
  cachedData = data;
}

export function resetQuickFilesCache(): void {
  cachedData = null;
}

function generateId(): string {
  return `qf-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

export async function getQuickFiles(): Promise<QuickFile[]> {
  const data = await loadData();
  return data.files;
}

export async function getQuickFile(id: string): Promise<QuickFile | null> {
  const data = await loadData();
  return data.files.find(f => f.id === id) || null;
}

export async function createQuickFile(input: {
  name: string;
  filename: string;
  destPath: string;
  content: string;
  isDefault?: boolean;
  isSensitive?: boolean;
}): Promise<QuickFile> {
  const data = await loadData();
  const now = new Date().toISOString();

  const file: QuickFile = {
    id: generateId(),
    name: input.name,
    filename: input.filename,
    destPath: input.destPath,
    content: input.content,
    isDefault: input.isDefault ?? false,
    ...(input.isSensitive && { isSensitive: true }),
    createdAt: now,
    updatedAt: now,
  };

  data.files.unshift(file);
  await saveData(data);
  return file;
}

export async function updateQuickFile(id: string, input: {
  name?: string;
  filename?: string;
  destPath?: string;
  content?: string;
  isDefault?: boolean;
  isSensitive?: boolean;
}): Promise<QuickFile | null> {
  const data = await loadData();
  const index = data.files.findIndex(f => f.id === id);

  if (index === -1) {
    return null;
  }

  const file = data.files[index];
  const updated: QuickFile = {
    ...file,
    ...(input.name !== undefined && { name: input.name }),
    ...(input.filename !== undefined && { filename: input.filename }),
    ...(input.destPath !== undefined && { destPath: input.destPath }),
    ...(input.content !== undefined && { content: input.content }),
    ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
    ...(input.isSensitive !== undefined && { isSensitive: input.isSensitive }),
    updatedAt: new Date().toISOString(),
  };

  data.files[index] = updated;
  await saveData(data);
  return updated;
}

export async function deleteQuickFile(id: string): Promise<boolean> {
  const data = await loadData();
  const index = data.files.findIndex(f => f.id === id);

  if (index === -1) {
    return false;
  }

  data.files.splice(index, 1);
  await saveData(data);
  return true;
}

export async function getDefaultQuickFiles(): Promise<QuickFile[]> {
  const data = await loadData();
  return data.files.filter(f => f.isDefault);
}
