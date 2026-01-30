import { fetchAPI } from './client';

export interface ForkWorktreeRequest {
  sandboxId: string;
  branchName: string;
  baseBranch?: string;
  cwd?: string;
}

export interface ForkWorktreeResponse {
  id: string;
  sandboxId: string;
  worktreePath: string;
  branch: string;
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

export async function getContainerBranch(containerId: string, cwd?: string): Promise<string> {
  const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  const res = await fetchAPI<{ branch: string }>(`/containers/${containerId}/branch${params}`);
  return res.branch;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  email: string;
  date: string;
}

export interface GitLogResponse {
  commits: GitCommit[];
  branch: string;
}

export async function getContainerGitLog(containerId: string, limit = 50, cwd?: string): Promise<GitLogResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cwd) params.set('cwd', cwd);
  return fetchAPI<GitLogResponse>(`/containers/${containerId}/git-log?${params}`);
}

export async function getContainerGitShow(containerId: string, hash: string, cwd?: string): Promise<string> {
  const params = cwd ? `?cwd=${encodeURIComponent(cwd)}` : '';
  const res = await fetchAPI<{ output: string }>(`/containers/${containerId}/git-show/${hash}${params}`);
  return res.output;
}
