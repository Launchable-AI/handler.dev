import { useQuery } from '@tanstack/react-query';
import * as api from '../api/client';
import { useHealth } from './useContainers';

/**
 * Fetch all builder images. Only enabled when devMode is active.
 */
export function useBuilderImages() {
  const { data: health } = useHealth();

  return useQuery({
    queryKey: ['builder-images'],
    queryFn: api.listBuilderImages,
    enabled: health?.devMode === true,
    refetchInterval: 5000,
  });
}

/**
 * Fetch detail/inspection for a single builder image.
 */
export function useBuilderImageDetail(name: string | null) {
  const { data: health } = useHealth();

  return useQuery({
    queryKey: ['builder-images', name],
    queryFn: () => api.inspectBuilderImage(name!),
    enabled: health?.devMode === true && !!name,
  });
}
