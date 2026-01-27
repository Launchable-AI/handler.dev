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
      // Add the new sandbox to ALL sandbox list queries
      queryClient.setQueriesData<api.SandboxListResponse>(
        { queryKey: ['sandboxes'] },
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

      // Snapshot all sandbox queries for rollback
      const previousQueries = queryClient.getQueriesData<api.SandboxListResponse>({
        queryKey: ['sandboxes'],
      });

      // Optimistically update to starting state in ALL sandbox list queries
      queryClient.setQueriesData<api.SandboxListResponse>(
        { queryKey: ['sandboxes'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            sandboxes: old.sandboxes.map((s) =>
              s.id === sandboxId ? { ...s, status: 'starting' as const } : s
            ),
          };
        }
      );

      return { previousQueries, sandboxId };
    },
    onSuccess: (updatedSandbox, sandboxId) => {
      // Update the sandbox with actual server response in all queries
      queryClient.setQueriesData<api.SandboxListResponse>(
        { queryKey: ['sandboxes'] },
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
      // Rollback all queries to their previous state
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
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

      // Snapshot all sandbox queries for rollback
      const previousQueries = queryClient.getQueriesData<api.SandboxListResponse>({
        queryKey: ['sandboxes'],
      });

      // Optimistically update to stopping state in ALL sandbox list queries
      queryClient.setQueriesData<api.SandboxListResponse>(
        { queryKey: ['sandboxes'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            sandboxes: old.sandboxes.map((s) =>
              s.id === sandboxId ? { ...s, status: 'stopping' as const } : s
            ),
          };
        }
      );

      return { previousQueries, sandboxId };
    },
    onSuccess: (updatedSandbox, sandboxId) => {
      // Update the sandbox with actual server response in all queries
      queryClient.setQueriesData<api.SandboxListResponse>(
        { queryKey: ['sandboxes'] },
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
      // Rollback all queries to their previous state
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
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

      // Snapshot all sandbox queries for rollback
      const previousQueries = queryClient.getQueriesData<api.SandboxListResponse>({
        queryKey: ['sandboxes'],
      });

      // Optimistically remove the sandbox from ALL sandbox list queries
      queryClient.setQueriesData<api.SandboxListResponse>(
        { queryKey: ['sandboxes'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            sandboxes: old.sandboxes.filter((s) => s.id !== sandboxId),
          };
        }
      );

      return { previousQueries, sandboxId };
    },
    onError: (_err, _sandboxId, context) => {
      // Rollback all queries to their previous state
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['sandboxes'] });
    },
  });
}

/**
 * Rename a sandbox (Firecracker VMs only)
 */
export function useRenameSandbox() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['sandbox-state'],
    mutationFn: ({ id, name }: { id: string; name: string }) => api.renameSandbox(id, name),
    onMutate: async ({ id, name }) => {
      await queryClient.cancelQueries({ queryKey: ['sandboxes'] });

      // Snapshot all sandbox queries for rollback
      const previousQueries = queryClient.getQueriesData<api.SandboxListResponse>({
        queryKey: ['sandboxes'],
      });

      // Optimistically update the name in ALL sandbox list queries
      queryClient.setQueriesData<api.SandboxListResponse>(
        { queryKey: ['sandboxes'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            sandboxes: old.sandboxes.map((s) =>
              s.id === id ? { ...s, name } : s
            ),
          };
        }
      );

      return { previousQueries, id };
    },
    onSuccess: (updatedSandbox, { id }) => {
      // Update the sandbox with actual server response in all queries
      queryClient.setQueriesData<api.SandboxListResponse>(
        { queryKey: ['sandboxes'] },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            sandboxes: old.sandboxes.map((s) =>
              s.id === id ? updatedSandbox : s
            ),
          };
        }
      );
    },
    onError: (_err, _vars, context) => {
      // Rollback all queries to their previous state
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
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
