import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/client';
import type { QuickFile } from '../api/client';

/**
 * List all quick files
 */
export function useQuickFiles() {
  return useQuery({
    queryKey: ['quick-files'],
    queryFn: api.listQuickFiles,
    refetchInterval: 30000,
  });
}

/**
 * Create a new quick file
 */
export function useCreateQuickFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      name: string;
      filename: string;
      destPath: string;
      content: string;
      isDefault?: boolean;
    }) => api.createQuickFile(input),
    onSuccess: (newFile) => {
      queryClient.setQueryData<{ files: QuickFile[] }>(
        ['quick-files'],
        (old) => {
          if (!old) return { files: [newFile] };
          return { files: [newFile, ...old.files] };
        }
      );
      queryClient.invalidateQueries({ queryKey: ['quick-files'] });
    },
  });
}

/**
 * Update a quick file
 */
export function useUpdateQuickFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: {
      id: string;
      updates: {
        name?: string;
        filename?: string;
        destPath?: string;
        content?: string;
        isDefault?: boolean;
      };
    }) => api.updateQuickFile(id, updates),
    onSuccess: (updatedFile) => {
      queryClient.setQueryData<{ files: QuickFile[] }>(
        ['quick-files'],
        (old) => {
          if (!old) return { files: [updatedFile] };
          return {
            files: old.files.map(f => f.id === updatedFile.id ? updatedFile : f),
          };
        }
      );
      queryClient.invalidateQueries({ queryKey: ['quick-files'] });
    },
  });
}

/**
 * Delete a quick file
 */
export function useDeleteQuickFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.deleteQuickFile(id),
    onMutate: async (fileId) => {
      await queryClient.cancelQueries({ queryKey: ['quick-files'] });

      const previousData = queryClient.getQueryData<{ files: QuickFile[] }>(['quick-files']);

      if (previousData) {
        queryClient.setQueryData<{ files: QuickFile[] }>(
          ['quick-files'],
          { files: previousData.files.filter(f => f.id !== fileId) }
        );
      }

      return { previousData, fileId };
    },
    onError: (_err, _fileId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['quick-files'], context.previousData);
      }
      queryClient.invalidateQueries({ queryKey: ['quick-files'] });
    },
  });
}

/**
 * Copy a single quick file to a sandbox
 */
export function useCopyQuickFileToSandbox() {
  return useMutation({
    mutationFn: ({ fileId, sandboxId }: { fileId: string; sandboxId: string }) =>
      api.copyQuickFileToSandbox(fileId, sandboxId),
  });
}
