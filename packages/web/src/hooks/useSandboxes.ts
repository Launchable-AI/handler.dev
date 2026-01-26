/**
 * React Query hooks for the unified Sandbox API
 */

import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import * as api from '../api/client';
import type {
  Sandbox,
  SandboxBackend,
  SandboxListFilter,
} from '../api/client';

/**
 * List all sandboxes with optional filtering
 * Pauses polling while mutations are in flight
 */
export function useSandboxes(filter?: SandboxListFilter) {
  const isMutatingSandboxes = useIsMutating({ mutationKey: ['sandbox-state'] });

  return useQuery({
    queryKey: ['sandboxes', filter],
    queryFn: () => api.listSandboxes(filter),
    refetchInterval: isMutatingSandboxes > 0 ? false : 5000,
  });
}

/**
 * Get a single sandbox by ID
 */
export function useSandbox(id: string) {
  return useQuery({
    queryKey: ['sandboxes', id],
    queryFn: () => api.getSandbox(id),
    enabled: !!id,
  });
}

/**
 * Get backend availability status
 */
export function useSandboxBackends() {
  return useQuery({
    queryKey: ['sandbox-backends'],
    queryFn: api.getSandboxBackends,
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Create a new sandbox
 */
export function useCreateSandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createSandbox,
    onSuccess: (newSandbox) => {
      // Optimistically add the new sandbox to the list
      queryClient.setQueryData<api.SandboxListResponse>(
        ['sandboxes', undefined],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            sandboxes: [newSandbox, ...old.sandboxes],
          };
        }
      );
      // Invalidate to refetch full list
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
    },
  });
}

/**
 * Start a sandbox
 */
export function useStartSandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['sandbox-state'],
    mutationFn: api.startSandbox,
    onMutate: async (sandboxId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['sandboxes'] });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData<api.SandboxListResponse>(['sandboxes', undefined]);

      // Optimistically update to starting state
      if (previousData) {
        queryClient.setQueryData<api.SandboxListResponse>(
          ['sandboxes', undefined],
          {
            ...previousData,
            sandboxes: previousData.sandboxes.map((s) =>
              s.id === sandboxId ? { ...s, status: 'starting' as const } : s
            ),
          }
        );
      }

      return { previousData, sandboxId };
    },
    onSuccess: (updatedSandbox, sandboxId) => {
      // Update the sandbox in the list with actual data
      queryClient.setQueryData<api.SandboxListResponse>(
        ['sandboxes', undefined],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            sandboxes: old.sandboxes.map((s) =>
              s.id === sandboxId ? updatedSandbox : s
            ),
          };
        }
      );
    },
    onError: (_err, _sandboxId, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(['sandboxes', undefined], context.previousData);
      }
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
    },
  });
}

/**
 * Stop a sandbox
 */
export function useStopSandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['sandbox-state'],
    mutationFn: api.stopSandbox,
    onMutate: async (sandboxId) => {
      await queryClient.cancelQueries({ queryKey: ['sandboxes'] });

      const previousData = queryClient.getQueryData<api.SandboxListResponse>(['sandboxes', undefined]);

      // Optimistically update to stopping state
      if (previousData) {
        queryClient.setQueryData<api.SandboxListResponse>(
          ['sandboxes', undefined],
          {
            ...previousData,
            sandboxes: previousData.sandboxes.map((s) =>
              s.id === sandboxId ? { ...s, status: 'stopping' as const } : s
            ),
          }
        );
      }

      return { previousData, sandboxId };
    },
    onSuccess: (updatedSandbox, sandboxId) => {
      queryClient.setQueryData<api.SandboxListResponse>(
        ['sandboxes', undefined],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            sandboxes: old.sandboxes.map((s) =>
              s.id === sandboxId ? updatedSandbox : s
            ),
          };
        }
      );
    },
    onError: (_err, _sandboxId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['sandboxes', undefined], context.previousData);
      }
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
    },
  });
}

/**
 * Delete a sandbox
 */
export function useDeleteSandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['sandbox-state'],
    mutationFn: api.deleteSandbox,
    onMutate: async (sandboxId) => {
      await queryClient.cancelQueries({ queryKey: ['sandboxes'] });

      const previousData = queryClient.getQueryData<api.SandboxListResponse>(['sandboxes', undefined]);

      // Optimistically remove the sandbox from the list
      if (previousData) {
        queryClient.setQueryData<api.SandboxListResponse>(
          ['sandboxes', undefined],
          {
            ...previousData,
            sandboxes: previousData.sandboxes.filter((s) => s.id !== sandboxId),
          }
        );
      }

      return { previousData, sandboxId };
    },
    onError: (_err, _sandboxId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['sandboxes', undefined], context.previousData);
      }
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
    },
  });
}

/**
 * Utility hook to get sandbox counts by status
 */
export function useSandboxCounts(filter?: SandboxListFilter) {
  const { data } = useSandboxes(filter);

  if (!data) {
    return {
      total: 0,
      running: 0,
      stopped: 0,
      error: 0,
      building: 0,
    };
  }

  const counts = {
    total: data.sandboxes.length,
    running: 0,
    stopped: 0,
    error: 0,
    building: 0,
  };

  for (const sandbox of data.sandboxes) {
    switch (sandbox.status) {
      case 'running':
      case 'starting':
        counts.running++;
        break;
      case 'stopped':
      case 'stopping':
      case 'paused':
      case 'archived':
        counts.stopped++;
        break;
      case 'error':
        counts.error++;
        break;
      case 'building':
      case 'creating':
        counts.building++;
        break;
    }
  }

  return counts;
}

/**
 * Utility hook to group sandboxes by backend
 */
export function useSandboxesByBackend(filter?: SandboxListFilter) {
  const { data } = useSandboxes(filter);

  if (!data) {
    return {
      docker: [] as Sandbox[],
      'cloud-hypervisor': [] as Sandbox[],
      firecracker: [] as Sandbox[],
      daytona: [] as Sandbox[],
    };
  }

  const grouped: Record<SandboxBackend, Sandbox[]> = {
    docker: [],
    'cloud-hypervisor': [],
    firecracker: [],
    daytona: [],
  };

  for (const sandbox of data.sandboxes) {
    grouped[sandbox.backend].push(sandbox);
  }

  return grouped;
}

/**
 * Fetch sandbox logs
 */
export function useSandboxLogs(id: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['sandbox-logs', id],
    queryFn: () => api.getSandboxLogs(id),
    enabled: enabled && !!id,
    staleTime: 5000,
    refetchInterval: enabled ? 5000 : false,
  });
}
