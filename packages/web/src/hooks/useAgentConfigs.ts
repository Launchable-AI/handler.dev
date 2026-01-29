import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/client';

export function useAgentConfigs() {
  return useQuery({
    queryKey: ['agent-configs'],
    queryFn: api.getAgentConfigs,
  });
}

export function useAgentConfig(id: string) {
  return useQuery({
    queryKey: ['agent-configs', id],
    queryFn: () => api.getAgentConfig(id),
    enabled: !!id,
  });
}

export function useCreateAgentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.createAgentConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-configs'] });
    },
  });
}

export function useUpdateAgentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; name?: string; description?: string; mcpServers?: Record<string, api.MCPServerConfig>; claudeMd?: string; permissions?: api.AgentPermissions }) =>
      api.updateAgentConfig(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-configs'] });
    },
  });
}

export function useDeleteAgentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: api.deleteAgentConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-configs'] });
    },
  });
}

export function useInjectAgentConfig() {
  return useMutation({
    mutationFn: ({ configId, sandboxId }: { configId: string; sandboxId: string }) =>
      api.injectAgentConfig(configId, sandboxId),
  });
}
