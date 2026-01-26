/**
 * React Query hooks for the Template API
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/client';

// Types for templates
export type TemplateType = 'dockerfile' | 'vm-image' | 'snapshot';
export type TemplateStatus = 'draft' | 'building' | 'ready' | 'error';
export type TemplateArtifactBackend = 'docker' | 'vm' | 'daytona';

export interface TemplateArtifact {
  backend: TemplateArtifactBackend;
  artifactId: string;
  sizeMb?: number;
  builtAt: string;
  error?: string;
  status: 'building' | 'ready' | 'error';
}

export interface Template {
  id: string;
  name: string;
  description?: string;
  type: TemplateType;
  status: TemplateStatus;
  dockerfile?: string;
  baseImage?: string;
  artifacts: TemplateArtifact[];
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  error?: string;
}

export interface CreateTemplateRequest {
  name: string;
  description?: string;
  type: TemplateType;
  dockerfile?: string;
  baseImage?: string;
  tags?: string[];
}

export interface UpdateTemplateRequest {
  name?: string;
  description?: string;
  dockerfile?: string;
  baseImage?: string;
  tags?: string[];
}

export interface BuildTemplateRequest {
  backends: TemplateArtifactBackend[];
  options?: {
    force?: boolean;
    noCache?: boolean;
  };
}

export interface BuildJob {
  id: string;
  templateId: string;
  backend: TemplateArtifactBackend;
  status: 'pending' | 'building' | 'completed' | 'failed';
  progress: number;
  logs: string[];
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface TemplateListFilter {
  type?: TemplateType[];
  status?: TemplateStatus[];
  tags?: string[];
  search?: string;
}

// API functions
async function listTemplates(filter?: TemplateListFilter): Promise<{ templates: Template[] }> {
  const params = new URLSearchParams();
  if (filter?.type?.length) params.set('type', filter.type.join(','));
  if (filter?.status?.length) params.set('status', filter.status.join(','));
  if (filter?.tags?.length) params.set('tags', filter.tags.join(','));
  if (filter?.search) params.set('search', filter.search);

  const query = params.toString();
  return api.fetchAPI(`/templates${query ? `?${query}` : ''}`);
}

async function getTemplate(id: string): Promise<Template> {
  return api.fetchAPI(`/templates/${encodeURIComponent(id)}`);
}

async function createTemplate(request: CreateTemplateRequest): Promise<Template> {
  return api.fetchAPI('/templates', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

async function updateTemplate(id: string, updates: UpdateTemplateRequest): Promise<Template> {
  return api.fetchAPI(`/templates/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

async function deleteTemplate(id: string): Promise<void> {
  await api.fetchAPI(`/templates/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

async function buildTemplate(id: string, request: BuildTemplateRequest): Promise<{ jobs: BuildJob[] }> {
  return api.fetchAPI(`/templates/${encodeURIComponent(id)}/build`, {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

async function getTemplateBuildStatus(id: string): Promise<{
  templateStatus: TemplateStatus;
  artifacts: TemplateArtifact[];
  activeJobs: BuildJob[];
  recentJobs: BuildJob[];
}> {
  return api.fetchAPI(`/templates/${encodeURIComponent(id)}/build/status`);
}

// Hooks

/**
 * List all templates with optional filtering
 */
export function useTemplates(filter?: TemplateListFilter) {
  return useQuery({
    queryKey: ['templates', filter],
    queryFn: () => listTemplates(filter),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

/**
 * Get a single template by ID
 */
export function useTemplate(id: string) {
  return useQuery({
    queryKey: ['templates', id],
    queryFn: () => getTemplate(id),
    enabled: !!id,
  });
}

/**
 * Create a new template
 */
export function useCreateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTemplate,
    onSuccess: (newTemplate) => {
      queryClient.setQueryData<{ templates: Template[] }>(
        ['templates', undefined],
        (old) => {
          if (!old) return { templates: [newTemplate] };
          return {
            templates: [newTemplate, ...old.templates],
          };
        }
      );
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

/**
 * Update a template
 */
export function useUpdateTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: UpdateTemplateRequest }) =>
      updateTemplate(id, updates),
    onSuccess: (updatedTemplate, { id }) => {
      queryClient.setQueryData(['templates', id], updatedTemplate);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

/**
 * Delete a template
 */
export function useDeleteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteTemplate,
    onMutate: async (templateId) => {
      await queryClient.cancelQueries({ queryKey: ['templates'] });

      const previousData = queryClient.getQueryData<{ templates: Template[] }>(['templates', undefined]);

      if (previousData) {
        queryClient.setQueryData<{ templates: Template[] }>(
          ['templates', undefined],
          {
            templates: previousData.templates.filter((t) => t.id !== templateId),
          }
        );
      }

      return { previousData, templateId };
    },
    onError: (_err, _templateId, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(['templates', undefined], context.previousData);
      }
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

/**
 * Build a template
 */
export function useBuildTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, request }: { id: string; request: BuildTemplateRequest }) =>
      buildTemplate(id, request),
    onSuccess: (_, { id }) => {
      // Mark template as building
      queryClient.setQueryData<Template>(['templates', id], (old) => {
        if (!old) return old;
        return { ...old, status: 'building' };
      });
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      queryClient.invalidateQueries({ queryKey: ['template-build-status', id] });
    },
  });
}

/**
 * Get template build status
 */
export function useTemplateBuildStatus(id: string, enabled = true) {
  return useQuery({
    queryKey: ['template-build-status', id],
    queryFn: () => getTemplateBuildStatus(id),
    enabled: enabled && !!id,
    refetchInterval: (query) => {
      // Poll more frequently if there are active builds
      const data = query.state.data;
      if (data?.activeJobs && data.activeJobs.length > 0) {
        return 2000; // 2 seconds
      }
      return 10000; // 10 seconds
    },
  });
}

/**
 * Utility hook to get templates by type
 */
export function useTemplatesByType(filter?: TemplateListFilter) {
  const { data } = useTemplates(filter);

  if (!data) {
    return {
      dockerfile: [] as Template[],
      'vm-image': [] as Template[],
      snapshot: [] as Template[],
    };
  }

  const grouped: Record<TemplateType, Template[]> = {
    dockerfile: [],
    'vm-image': [],
    snapshot: [],
  };

  for (const template of data.templates) {
    grouped[template.type].push(template);
  }

  return grouped;
}

/**
 * Utility hook to count templates by status
 */
export function useTemplateCounts(filter?: TemplateListFilter) {
  const { data } = useTemplates(filter);

  if (!data) {
    return {
      total: 0,
      draft: 0,
      building: 0,
      ready: 0,
      error: 0,
    };
  }

  const counts = {
    total: data.templates.length,
    draft: 0,
    building: 0,
    ready: 0,
    error: 0,
  };

  for (const template of data.templates) {
    counts[template.status]++;
  }

  return counts;
}
