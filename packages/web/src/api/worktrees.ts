import { fetchAPI } from './client';

export interface ForkWorktreeRequest {
  sandboxId: string;
  branchName: string;
  baseBranch?: string;
}

export interface ForkWorktreeResponse {
  id: string;
  sandboxId: string;
  worktreePath: string;
  branch: string;
  ports: Array<{ container: number; host: number }>;
}

export interface MergeWorktreeRequest {
  sandboxId: string;
  worktreeId: string;
  strategy?: 'merge' | 'rebase';
}

export interface MergeWorktreeResponse {
  success: boolean;
  conflicts?: string[];
}

export interface WorktreeInfo {
  id: string;
  branch: string;
  path: string;
  head: string;
}

export interface WorktreeStatus {
  status: 'clean' | 'dirty' | 'conflict';
  changedFiles?: string[];
  conflictFiles?: string[];
}

export async function forkWorktree(request: ForkWorktreeRequest): Promise<ForkWorktreeResponse> {
  return fetchAPI<ForkWorktreeResponse>('/worktrees/fork', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function listWorktrees(sandboxId: string): Promise<WorktreeInfo[]> {
  return fetchAPI<WorktreeInfo[]>(`/worktrees/${sandboxId}`);
}

export async function mergeWorktree(request: MergeWorktreeRequest): Promise<MergeWorktreeResponse> {
  return fetchAPI<MergeWorktreeResponse>('/worktrees/merge', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function deleteWorktree(id: string): Promise<void> {
  return fetchAPI<void>(`/worktrees/${id}`, {
    method: 'DELETE',
  });
}

export async function getWorktreeStatus(id: string): Promise<WorktreeStatus> {
  return fetchAPI<WorktreeStatus>(`/worktrees/${id}/status`);
}
