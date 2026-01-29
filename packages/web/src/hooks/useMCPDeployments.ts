import { useState, useEffect, useCallback } from 'react';
import * as api from '../api/client';
import type { MCPDeployment, MCPLocalServer } from '../api/client';

const POLL_INTERVAL = 5000;

export function useMCPDeployments() {
  const [deployments, setDeployments] = useState<MCPDeployment[]>([]);
  const [localServers, setLocalServers] = useState<MCPLocalServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [deploymentsResult, localResult] = await Promise.all([
        api.listMCPDeployments(),
        api.discoverLocalMCPServers(),
      ]);
      setDeployments(deploymentsResult.deployments);
      setLocalServers(localResult.servers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deployments');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [refresh]);

  const stop = useCallback(async (id: string) => {
    await api.stopMCPDeployment(id);
    await refresh();
  }, [refresh]);

  const restart = useCallback(async (id: string) => {
    await api.restartMCPDeployment(id);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await api.deleteMCPDeployment(id);
    await refresh();
  }, [refresh]);

  return {
    deployments,
    localServers,
    isLoading,
    error,
    refresh,
    stop,
    restart,
    remove,
  };
}
