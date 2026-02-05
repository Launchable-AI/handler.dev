import { useQuery, useMutation, useQueryClient, useIsMutating } from '@tanstack/react-query';
import * as api from '../api/client';

export function useContainers() {
  // Pause polling while container state mutations are in flight
  const isMutatingContainers = useIsMutating({ mutationKey: ['container-state'] });

  return useQuery({
    queryKey: ['containers'],
    queryFn: api.listContainers,
    refetchInterval: isMutatingContainers > 0 ? false : 5000,
  });
}

export function useContainer(id: string) {
  return useQuery({
    queryKey: ['containers', id],
    queryFn: () => api.getContainer(id),
  });
}

export function useCreateContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createContainer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
  });
}

export function useStartContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['container-state'],
    mutationFn: api.startContainer,
    onMutate: async (containerId) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['containers'] });

      // Snapshot the previous value
      const previousContainers = queryClient.getQueryData<api.ContainerInfo[]>(['containers']);

      // Optimistically update to the new value
      if (previousContainers) {
        queryClient.setQueryData<api.ContainerInfo[]>(['containers'],
          previousContainers.map(c =>
            c.id === containerId
              ? { ...c, state: 'running' as const }
              : c
          )
        );
      }

      // Return context with the previous value
      return { previousContainers, containerId };
    },
    onSuccess: async (data, containerId, context) => {
      // If container was recreated due to port conflict, use new ID
      const actualId = data.newId || containerId;

      if (data.recreated) {
        // Container was recreated - refetch the full list to get new container
        await queryClient.invalidateQueries({ queryKey: ['containers'] });
      } else {
        // Normal start - fetch updated container to get full details
        const updatedContainer = await api.getContainer(actualId);
        queryClient.setQueryData<api.ContainerInfo[]>(['containers'], (old) =>
          old?.map(c => c.id === context?.containerId ? updatedContainer : c)
        );
      }
    },
    onError: (_err, _containerId, context) => {
      // Rollback to previous value on error
      if (context?.previousContainers) {
        queryClient.setQueryData(['containers'], context.previousContainers);
      }
      // Only refetch on error to get actual state
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
  });
}

export function useStopContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['container-state'],
    mutationFn: api.stopContainer,
    onMutate: async (containerId) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ['containers'] });

      // Snapshot the previous value
      const previousContainers = queryClient.getQueryData<api.ContainerInfo[]>(['containers']);

      // Optimistically update to the new value
      if (previousContainers) {
        queryClient.setQueryData<api.ContainerInfo[]>(['containers'],
          previousContainers.map(c =>
            c.id === containerId
              ? { ...c, state: 'exited' as const }
              : c
          )
        );
      }

      // Return context with the previous value
      return { previousContainers };
    },
    onSuccess: async (_data, containerId) => {
      // Fetch updated container to get accurate state
      const updatedContainer = await api.getContainer(containerId);
      queryClient.setQueryData<api.ContainerInfo[]>(['containers'], (old) =>
        old?.map(c => c.id === containerId ? updatedContainer : c)
      );
    },
    onError: (_err, _containerId, context) => {
      // Rollback to previous value on error
      if (context?.previousContainers) {
        queryClient.setQueryData(['containers'], context.previousContainers);
      }
      // Only refetch on error to get actual state
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
  });
}

export function useRemoveContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.removeContainer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
  });
}

export function useReconfigureContainer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...request }: { id: string } & api.ReconfigureContainerRequest) =>
      api.reconfigureContainer(id, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] });
    },
  });
}

export function useImages() {
  return useQuery({
    queryKey: ['images'],
    queryFn: api.listImages,
  });
}

export function usePullImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.pullImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] });
    },
  });
}

export function useVolumes() {
  return useQuery({
    queryKey: ['volumes'],
    queryFn: api.listVolumes,
  });
}

export function useCreateVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createVolume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes'] });
    },
  });
}

export function useRemoveVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.removeVolume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['volumes'] });
    },
  });
}

export function useDockerfiles() {
  return useQuery({
    queryKey: ['dockerfiles'],
    queryFn: api.listDockerfiles,
  });
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.checkHealth,
    refetchInterval: 10000,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
  });
}

export function useUpdateConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

// Quick Launch config
export function useQuickLaunchConfig() {
  return useQuery({
    queryKey: ['quick-launch-config'],
    queryFn: api.getQuickLaunchConfig,
  });
}

export function useSetQuickLaunchConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.setQuickLaunchConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-launch-config'] });
    },
  });
}

export function useDeleteQuickLaunchConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteQuickLaunchConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-launch-config'] });
    },
  });
}

// ============ VM Hooks ============

export function useVms() {
  const isMutatingVms = useIsMutating({ mutationKey: ['vm-state'] });

  return useQuery({
    queryKey: ['vms'],
    queryFn: api.listVms,
    refetchInterval: isMutatingVms > 0 ? false : 5000,
  });
}

export function useVm(id: string) {
  return useQuery({
    queryKey: ['vms', id],
    queryFn: () => api.getVm(id),
    enabled: !!id,
  });
}

export function useCreateVm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createVm,
    onMutate: async (params) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['vms'] });
      const previousVms = queryClient.getQueryData<api.VmInfo[]>(['vms']);

      // Optimistically add the new VM to the list with "creating" status
      // Use a temporary ID that will be replaced when the API returns
      const optimisticVm: api.VmInfo = {
        id: `temp-${Date.now()}`,
        name: params.name,
        status: 'creating',
        state: 'creating',
        image: params.baseImage || 'ubuntu-24.04',
        vcpus: params.vcpus || 1,
        memoryMb: params.memoryMb || 1024,
        diskGb: params.diskGb || 5,
        sshPort: 0,
        sshHost: 'localhost',
        sshUser: 'agent',
        networkMode: 'tap',
        ports: [],
        volumes: params.volumes || [],
        createdAt: new Date().toISOString(),
      };

      if (previousVms) {
        queryClient.setQueryData<api.VmInfo[]>(['vms'], [...previousVms, optimisticVm]);
      }

      return { previousVms, optimisticVm };
    },
    onSuccess: (createdVm, _params, context) => {
      // Replace the optimistic VM with the real one from the server
      queryClient.setQueryData<api.VmInfo[]>(['vms'], (old) => {
        if (!old || !context?.optimisticVm) return old;
        return old.map(vm =>
          vm.id === context.optimisticVm.id ? createdVm : vm
        );
      });
    },
    onError: (_err, _params, context) => {
      // Roll back to previous state on error
      if (context?.previousVms) {
        queryClient.setQueryData(['vms'], context.previousVms);
      }
    },
    onSettled: () => {
      // Refetch to ensure data is in sync
      queryClient.invalidateQueries({ queryKey: ['vms'] });
    },
  });
}

export function useStartVm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['vm-state'],
    mutationFn: api.startVm,
    onMutate: async (vmId) => {
      await queryClient.cancelQueries({ queryKey: ['vms'] });
      const previousVms = queryClient.getQueryData<api.VmInfo[]>(['vms']);

      if (previousVms) {
        queryClient.setQueryData<api.VmInfo[]>(['vms'],
          previousVms.map(vm =>
            vm.id === vmId
              ? { ...vm, status: 'booting' as const, state: 'booting' as const }
              : vm
          )
        );
      }

      return { previousVms };
    },
    onSuccess: async (_data, vmId) => {
      try {
        const updatedVm = await api.getVm(vmId);
        queryClient.setQueryData<api.VmInfo[]>(['vms'], (old) =>
          old?.map(vm => vm.id === vmId ? updatedVm : vm)
        );
      } catch {
        // VM may have been deleted - just refetch the list
        queryClient.invalidateQueries({ queryKey: ['vms'] });
      }
    },
    onError: (_err, _vmId, context) => {
      if (context?.previousVms) {
        queryClient.setQueryData(['vms'], context.previousVms);
      }
      queryClient.invalidateQueries({ queryKey: ['vms'] });
    },
  });
}

export function useStopVm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['vm-state'],
    mutationFn: api.stopVm,
    onMutate: async (vmId) => {
      await queryClient.cancelQueries({ queryKey: ['vms'] });
      const previousVms = queryClient.getQueryData<api.VmInfo[]>(['vms']);

      if (previousVms) {
        queryClient.setQueryData<api.VmInfo[]>(['vms'],
          previousVms.map(vm =>
            vm.id === vmId
              ? { ...vm, status: 'stopped' as const, state: 'stopped' as const }
              : vm
          )
        );
      }

      return { previousVms };
    },
    onSuccess: async (_data, vmId) => {
      try {
        const updatedVm = await api.getVm(vmId);
        queryClient.setQueryData<api.VmInfo[]>(['vms'], (old) =>
          old?.map(vm => vm.id === vmId ? updatedVm : vm)
        );
      } catch {
        // VM may have been deleted - just refetch the list
        queryClient.invalidateQueries({ queryKey: ['vms'] });
      }
    },
    onError: (_err, _vmId, context) => {
      if (context?.previousVms) {
        queryClient.setQueryData(['vms'], context.previousVms);
      }
      queryClient.invalidateQueries({ queryKey: ['vms'] });
    },
  });
}

export function useDeleteVm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteVm,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
    },
  });
}

export function useUpdateVmPorts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vmId, ports }: { vmId: string; ports: Array<{ container: number; host: number }> }) =>
      api.updateVmPorts(vmId, ports),
    onSuccess: (updatedVm) => {
      queryClient.setQueryData<api.VmInfo[]>(['vms'], (old) =>
        old?.map(vm => vm.id === updatedVm.id ? updatedVm : vm)
      );
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
    },
  });
}

export function useVmStats() {
  return useQuery({
    queryKey: ['vms', 'stats'],
    queryFn: api.getVmStats,
    refetchInterval: 10000,
  });
}

export function useVmNetworkStatus() {
  return useQuery({
    queryKey: ['vms', 'network'],
    queryFn: api.getVmNetworkStatus,
    refetchInterval: 30000,
  });
}

export function useVmBaseImages() {
  return useQuery({
    queryKey: ['vms', 'base-images'],
    queryFn: api.listVmBaseImages,
    refetchInterval: 10000, // Refresh to catch warmup status changes
  });
}

export function useDeleteVmBaseImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteVmBaseImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vms', 'base-images'] });
    },
  });
}

export function useTriggerVmWarmup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.triggerVmWarmup,
    onSuccess: (_data, baseImage) => {
      // Invalidate warmup status to trigger polling
      queryClient.invalidateQueries({ queryKey: ['vms', 'warmup-status', baseImage] });
      queryClient.invalidateQueries({ queryKey: ['vms', 'base-images'] });
    },
  });
}

// VM Snapshot hooks
export function useVmSnapshots(vmId: string) {
  return useQuery({
    queryKey: ['vms', vmId, 'snapshots'],
    queryFn: () => api.listVmSnapshots(vmId),
    enabled: !!vmId,
    refetchInterval: 10000,
  });
}

export function useCreateVmSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vmId, name }: { vmId: string; name?: string }) =>
      api.createVmSnapshot(vmId, name),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vms', variables.vmId, 'snapshots'] });
    },
  });
}

export function useDeleteVmSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vmId, snapshotId }: { vmId: string; snapshotId: string }) =>
      api.deleteVmSnapshot(vmId, snapshotId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vms', variables.vmId, 'snapshots'] });
      queryClient.invalidateQueries({ queryKey: ['vms', 'all-snapshots'] });
    },
  });
}

export function useRollbackVmToSnapshot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vmId, snapshotId }: { vmId: string; snapshotId: string }) =>
      api.rollbackVmToSnapshot(vmId, snapshotId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vms'] });
      queryClient.invalidateQueries({ queryKey: ['vms', variables.vmId] });
    },
  });
}

export function usePromoteSnapshotToImage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vmId, snapshotId, imageName }: { vmId: string; snapshotId: string; imageName: string }) =>
      api.promoteSnapshotToImage(vmId, snapshotId, imageName),
    onSuccess: () => {
      // Invalidate base images list when a new image is created
      queryClient.invalidateQueries({ queryKey: ['vms', 'base-images'] });
    },
  });
}

export function useAllVmSnapshots() {
  return useQuery({
    queryKey: ['vms', 'all-snapshots'],
    queryFn: api.listAllVmSnapshots,
    refetchInterval: 10000,
  });
}

export function useWarmupStatus(baseImage: string, enabled: boolean = true) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['vms', 'warmup-status', baseImage],
    queryFn: () => api.getWarmupStatus(baseImage),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Poll frequently while warming up, stop when complete/idle/error
      if (data?.phase === 'complete' || data?.phase === 'idle' || data?.phase === 'error') {
        // Invalidate base images to refresh the list
        if (data?.phase === 'complete') {
          queryClient.invalidateQueries({ queryKey: ['vms', 'base-images'] });
        }
        return false;
      }
      return 1000; // Poll every second during warmup
    },
  });
}

export function useClearWarmupStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.clearWarmupStatus,
    onSuccess: (_data, baseImage) => {
      queryClient.invalidateQueries({ queryKey: ['vms', 'warmup-status', baseImage] });
    },
  });
}

export function useWarmupLogs(baseImage: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['vms', 'warmup-logs', baseImage],
    queryFn: () => api.getWarmupLogs(baseImage),
    enabled,
    refetchInterval: enabled ? 1000 : false, // Poll every second when enabled
  });
}

// VM File Operations
export function useVmFiles(vmId: string, path: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['vms', vmId, 'files', path],
    queryFn: () => api.listVmFiles(vmId, path),
    enabled,
  });
}

export function useUploadFileToVm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vmId, file, destPath }: { vmId: string; file: File; destPath: string }) =>
      api.uploadFileToVm(vmId, file, destPath),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vms', variables.vmId, 'files'] });
    },
  });
}

export function useDeleteVmFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vmId, filePath }: { vmId: string; filePath: string }) =>
      api.deleteVmFile(vmId, filePath),
    onSuccess: (_data, variables) => {
      // Invalidate the parent directory
      const parentPath = variables.filePath.split('/').slice(0, -1).join('/') || '/';
      queryClient.invalidateQueries({ queryKey: ['vms', variables.vmId, 'files', parentPath] });
    },
  });
}

// Host Stats
export function useHostStats() {
  return useQuery({
    queryKey: ['host-stats'],
    queryFn: api.getHostStats,
    refetchInterval: 3000, // Refresh every 3 seconds
  });
}

// ========== VM Volumes ==========

export function useVmVolumes() {
  return useQuery({
    queryKey: ['vm-volumes'],
    queryFn: api.listVmVolumes,
    refetchInterval: 10000,
  });
}

export function useVmVolume(id: string) {
  return useQuery({
    queryKey: ['vm-volumes', id],
    queryFn: () => api.getVmVolume(id),
    enabled: !!id,
  });
}

export function useCreateVmVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createVmVolume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vm-volumes'] });
    },
  });
}

export function useDeleteVmVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteVmVolume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vm-volumes'] });
    },
  });
}

export function useAttachVmVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ volumeId, vmId }: { volumeId: string; vmId: string }) =>
      api.attachVmVolume(volumeId, vmId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vm-volumes'] });
      queryClient.invalidateQueries({ queryKey: ['vms'] });
    },
  });
}

export function useDetachVmVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.detachVmVolume,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vm-volumes'] });
      queryClient.invalidateQueries({ queryKey: ['vms'] });
    },
  });
}

export function useResizeVmVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ volumeId, sizeGb }: { volumeId: string; sizeGb: number }) =>
      api.resizeVmVolume(volumeId, sizeGb),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vm-volumes'] });
    },
  });
}

export function useVmAttachedVolumes(vmId: string) {
  return useQuery({
    queryKey: ['vm-volumes', 'vm', vmId],
    queryFn: () => api.getVmAttachedVolumes(vmId),
    enabled: !!vmId,
  });
}

// VM Volume File Operations
export function useVmVolumeFiles(volumeId: string, path: string = '/') {
  return useQuery({
    queryKey: ['vm-volumes', volumeId, 'files', path],
    queryFn: () => api.listVmVolumeFiles(volumeId, path),
    enabled: !!volumeId,
  });
}

export function useUploadFileToVmVolume() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ volumeId, file, destPath }: { volumeId: string; file: File; destPath: string }) =>
      api.uploadFileToVmVolume(volumeId, file, destPath),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vm-volumes', variables.volumeId, 'files'] });
      queryClient.invalidateQueries({ queryKey: ['vm-volumes'] });
    },
  });
}

export function useDeleteVmVolumeFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ volumeId, filePath }: { volumeId: string; filePath: string }) =>
      api.deleteVmVolumeFile(volumeId, filePath),
    onSuccess: (_data, variables) => {
      const parentPath = variables.filePath.split('/').slice(0, -1).join('/') || '/';
      queryClient.invalidateQueries({ queryKey: ['vm-volumes', variables.volumeId, 'files', parentPath] });
    },
  });
}

export function useBackendStatus() {
  return useQuery({
    queryKey: ['backend-status'],
    queryFn: api.getBackendStatus,
    refetchInterval: 30000, // Refresh every 30 seconds
    staleTime: 10000,
  });
}

export function useRefreshDaytonaCache() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.refreshDaytonaCache,
    onSuccess: () => {
      // Invalidate VMs cache to trigger a refetch with fresh Daytona data
      queryClient.invalidateQueries({ queryKey: ['vms'] });
    },
  });
}
