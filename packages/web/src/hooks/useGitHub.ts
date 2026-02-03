/**
 * React Query hooks for GitHub API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/client';

/**
 * Get GitHub connection status
 */
export function useGitHubStatus() {
  return useQuery({
    queryKey: ['github', 'status'],
    queryFn: api.getGitHubStatus,
    staleTime: 30000,
  });
}

/**
 * Configure GitHub OAuth credentials
 */
export function useConfigureGitHub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ clientId, clientSecret }: { clientId: string; clientSecret: string }) =>
      api.configureGitHub(clientId, clientSecret),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github', 'status'] });
    },
  });
}

/**
 * Exchange OAuth code for token
 */
export function useExchangeGitHubCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ code, redirectUri }: { code: string; redirectUri: string }) =>
      api.exchangeGitHubCode(code, redirectUri),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['github', 'repos'] });
    },
  });
}

/**
 * Disconnect GitHub account
 */
export function useDisconnectGitHub() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.disconnectGitHub,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['github', 'repos'] });
    },
  });
}

/**
 * Clear all GitHub credentials (OAuth app + access token)
 */
export function useClearGitHubCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.clearGitHubCredentials,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['github', 'repos'] });
    },
  });
}

/**
 * List GitHub repositories
 */
export function useGitHubRepos(options?: {
  page?: number;
  perPage?: number;
  sort?: 'updated' | 'pushed' | 'full_name';
  type?: 'all' | 'owner' | 'member';
  enabled?: boolean;
}) {
  const { enabled = true, ...queryOptions } = options || {};

  return useQuery({
    queryKey: ['github', 'repos', queryOptions],
    queryFn: () => api.listGitHubRepos(queryOptions),
    enabled,
    staleTime: 60000, // 1 minute
  });
}

/**
 * Get a specific GitHub repository
 */
export function useGitHubRepo(owner: string, repo: string, enabled = true) {
  return useQuery({
    queryKey: ['github', 'repo', owner, repo],
    queryFn: () => api.getGitHubRepo(owner, repo),
    enabled: enabled && !!owner && !!repo,
    staleTime: 60000,
  });
}

/**
 * Get current GitHub user
 */
export function useGitHubUser(enabled = true) {
  return useQuery({
    queryKey: ['github', 'user'],
    queryFn: api.getGitHubUser,
    enabled,
    staleTime: 300000, // 5 minutes
  });
}

/**
 * Start work on a repository
 */
export function useStartWork() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.startWork,
    onSuccess: () => {
      // Invalidate sandboxes to show the new one
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
  });
}

/**
 * Set visible repos
 */
export function useSetVisibleRepos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (visibleRepos: 'all' | string[]) => api.setGitHubVisibleRepos(visibleRepos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github', 'status'] });
    },
  });
}
