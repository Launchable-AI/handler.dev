import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export interface QuickFile {
  id: string;
  name: string;
  filename: string;
  destPath: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..', '..', '..');
const DATA_FILE = join(PROJECT_ROOT, 'data', 'quick-files.json');

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
    const content = await readFile(DATA_FILE, 'utf-8');
    cachedData = JSON.parse(content) as QuickFilesData;
    return cachedData;
  } catch {
    return DEFAULT_DATA;
  }
}

async function saveData(data: QuickFilesData): Promise<void> {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2));
  cachedData = data;
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
