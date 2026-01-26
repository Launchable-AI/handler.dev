/**
 * React Query hooks for the unified Volume API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/client';
import type {
  UnifiedVolume,
  UnifiedVolumeBackend,
  UnifiedVolumeListFilter,
} from '../api/client';

/**
 * List all unified volumes with optional filtering
 */
export function useUnifiedVolumes(filter?: UnifiedVolumeListFilter) {
  return useQuery({
    queryKey: ['unified-volumes', filter],
    queryFn: () => api.listUnifiedVolumes(filter),
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

/**
 * Get a single unified volume by ID
 */
export function useUnifiedVolume(id: string) {
  return useQuery({
    queryKey: ['unified-volumes', id],
    queryFn: () => api.getUnifiedVolume(id),
    enabled: !!id,
  });
}

/**
 * Get unified volume backend availability
 */
export function useUnifiedVolumeBackends() {
  return useQuery({
    queryKey: ['unified-volume-backends'],
    queryFn: api.getUnifiedVolumeBackends,
    staleTime: 30000, // Cache for 30 seconds
  });
}

/**
 * Create a new unified volume
 */
export function useCreateUnifiedVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createUnifiedVolume,
    onSuccess: (newVolume) => {
      // Optimistically add the new volume to the list
      queryClient.setQueryData<api.UnifiedVolumeListResponse>(
        ['unified-volumes', undefined],
        (old) => {
          if (!old) return old;
          return {
            ...old,
            volumes: [newVolume, ...old.volumes],
          };
        }
      );
      // Invalidate to refetch full list
      queryClient.invalidateQueries({ queryKey: ['unified-volumes'] });
    },
  });
}

/**
 * Delete a unified volume
 */
export function useDeleteUnifiedVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteUnifiedVolume,
    onMutate: async (volumeId) => {
      await queryClient.cancelQueries({ queryKey: ['unified-volumes'] });

      const previousData = queryClient.getQueryData<api.UnifiedVolumeListResponse>(['unified-volumes', undefined]);

      // Optimistically remove the volume from the list
      if (previousData) {
        queryClient.setQueryData<api.UnifiedVolumeListResponse>(
          ['unified-volumes', undefined],
          {
            ...previousData,
            volumes: previousData.volumes.filter((v) => v.id !== volumeId),
          }
        );
      }

      return { previousData, volumeId };
    },
    onError: (_err, _volumeId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['unified-volumes', undefined], context.previousData);
      }
      queryClient.invalidateQueries({ queryKey: ['unified-volumes'] });
    },
  });
}

/**
 * List files in a unified volume
 */
export function useUnifiedVolumeFiles(volumeId: string, path: string = '/') {
  return useQuery({
    queryKey: ['unified-volume-files', volumeId, path],
    queryFn: () => api.listUnifiedVolumeFiles(volumeId, path),
    enabled: !!volumeId,
  });
}

/**
 * Upload file to a unified volume
 */
export function useUploadToUnifiedVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ volumeId, file, destPath }: { volumeId: string; file: File; destPath?: string }) =>
      api.uploadToUnifiedVolume(volumeId, file, destPath),
    onSuccess: (_, { volumeId }) => {
      // Invalidate files list for this volume
      queryClient.invalidateQueries({ queryKey: ['unified-volume-files', volumeId] });
    },
  });
}

/**
 * Delete file from a unified volume
 */
export function useDeleteUnifiedVolumeFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ volumeId, filePath }: { volumeId: string; filePath: string }) =>
      api.deleteUnifiedVolumeFile(volumeId, filePath),
    onSuccess: (_, { volumeId }) => {
      // Invalidate files list for this volume
      queryClient.invalidateQueries({ queryKey: ['unified-volume-files', volumeId] });
    },
  });
}

/**
 * Utility hook to get volume counts by backend
 */
export function useUnifiedVolumeCounts(filter?: UnifiedVolumeListFilter) {
  const { data } = useUnifiedVolumes(filter);

  if (!data) {
    return {
      total: 0,
      docker: 0,
      vm: 0,
      daytona: 0,
    };
  }

  const counts = {
    total: data.volumes.length,
    docker: 0,
    vm: 0,
    daytona: 0,
  };

  for (const volume of data.volumes) {
    counts[volume.backend]++;
  }

  return counts;
}

/**
 * Utility hook to group volumes by backend
 */
export function useUnifiedVolumesByBackend(filter?: UnifiedVolumeListFilter) {
  const { data } = useUnifiedVolumes(filter);

  if (!data) {
    return {
      docker: [] as UnifiedVolume[],
      vm: [] as UnifiedVolume[],
      daytona: [] as UnifiedVolume[],
    };
  }

  const grouped: Record<UnifiedVolumeBackend, UnifiedVolume[]> = {
    docker: [],
    vm: [],
    daytona: [],
  };

  for (const volume of data.volumes) {
    grouped[volume.backend].push(volume);
  }

  return grouped;
}
