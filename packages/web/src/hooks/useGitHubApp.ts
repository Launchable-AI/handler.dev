/**
 * React Query hooks for GitHub App API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/client';

/**
 * Get GitHub App connection status
 */
export function useGitHubAppStatus() {
  return useQuery({
    queryKey: ['github-app', 'status'],
    queryFn: api.getGitHubAppStatus,
    staleTime: 30000,
  });
}

/**
 * Configure GitHub App (App ID and Private Key)
 */
export function useConfigureGitHubApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ appId, privateKey }: { appId: string; privateKey: string }) =>
      api.configureGitHubApp(appId, privateKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-app', 'status'] });
    },
  });
}

/**
 * List GitHub App installations
 */
export function useGitHubAppInstallations(enabled = true) {
  return useQuery({
    queryKey: ['github-app', 'installations'],
    queryFn: api.listGitHubAppInstallations,
    enabled,
    staleTime: 60000,
  });
}

/**
 * Select a GitHub App installation
 */
export function useSelectGitHubAppInstallation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ installationId, username }: { installationId: string; username: string }) =>
      api.selectGitHubAppInstallation(installationId, username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-app', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['github-app', 'repos'] });
    },
  });
}

/**
 * Disconnect GitHub App
 */
export function useDisconnectGitHubApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.disconnectGitHubApp,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-app', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['github-app', 'repos'] });
    },
  });
}

/**
 * Clear all GitHub App credentials
 */
export function useClearGitHubAppCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.clearGitHubAppCredentials,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-app', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['github-app', 'repos'] });
      queryClient.invalidateQueries({ queryKey: ['github-app', 'installations'] });
    },
  });
}

/**
 * List GitHub App repositories
 */
export function useGitHubAppRepos(options?: {
  page?: number;
  perPage?: number;
  enabled?: boolean;
}) {
  const { enabled = true, ...queryOptions } = options || {};

  return useQuery({
    queryKey: ['github-app', 'repos', queryOptions],
    queryFn: () => api.listGitHubAppRepos(queryOptions),
    enabled,
    staleTime: 60000,
  });
}

/**
 * Get a specific GitHub App repository
 */
export function useGitHubAppRepo(owner: string, repo: string, enabled = true) {
  return useQuery({
    queryKey: ['github-app', 'repo', owner, repo],
    queryFn: () => api.getGitHubAppRepo(owner, repo),
    enabled: enabled && !!owner && !!repo,
    staleTime: 60000,
  });
}

/**
 * Set visible repos for GitHub App
 */
export function useSetGitHubAppVisibleRepos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (visibleRepos: 'all' | string[]) => api.setGitHubAppVisibleRepos(visibleRepos),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['github-app', 'status'] });
    },
  });
}
