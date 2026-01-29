/**
 * Container Registry abstraction layer
 *
 * Provides a unified interface for pushing Docker images to various registries:
 * Daytona, AWS ECR, Google Artifact Registry, Azure Container Registry, Docker Hub.
 */

import { getConfig } from '../config.js';
import { DaytonaRegistry } from './daytona.js';
import { EcrRegistry } from './ecr.js';
import { GcrRegistry } from './gcr.js';
import { AcrRegistry } from './acr.js';
import { DockerHubRegistry } from './dockerhub.js';

export type RegistryType = 'daytona' | 'ecr' | 'gcr' | 'acr' | 'dockerhub';

export type ProgressCallback = (message: string, type: 'info' | 'progress' | 'error' | 'done') => void;

export interface RegistryPushResult {
  registryType: RegistryType;
  registryUrl: string;
  remoteImage: string;
  pushedAt: string;
}

export interface ContainerRegistry {
  readonly type: RegistryType;
  login(): Promise<void>;
  getRemoteImageTag(localImage: string, imageName: string): string;
  push(localImage: string, imageName: string, onProgress: ProgressCallback): Promise<RegistryPushResult>;
  logout(): Promise<void>;
}

export interface RegistryPushRequest {
  localImage: string;
  imageName: string;
  registryType: RegistryType;
  // ECR-specific
  ecrRegion?: string;
  // GCR-specific
  gcrHostname?: string; // e.g. gcr.io, us-docker.pkg.dev
  // ACR-specific
  acrLoginServer?: string;
  // Daytona-specific
  regionId?: string;
}

/**
 * Get the list of available (configured) registries
 */
export async function getAvailableRegistries(): Promise<{ type: RegistryType; label: string; configured: boolean }[]> {
  const config = await getConfig();
  const cb = config.cloudBackends;

  return [
    {
      type: 'daytona' as RegistryType,
      label: 'Daytona',
      configured: !!(cb?.daytona?.apiKey && cb.daytona.enabled),
    },
    {
      type: 'ecr' as RegistryType,
      label: 'AWS ECR',
      configured: !!(cb?.aws?.accessKeyId && cb.aws.secretAccessKey && cb.aws.enabled),
    },
    {
      type: 'gcr' as RegistryType,
      label: 'Google Artifact Registry',
      configured: !!(cb?.gcp?.projectId && cb.gcp.keyFileJson && cb.gcp.enabled),
    },
    {
      type: 'acr' as RegistryType,
      label: 'Azure Container Registry',
      configured: !!(cb?.azure?.clientId && cb.azure.clientSecret && cb.azure.tenantId && cb.azure.subscriptionId && cb.azure.enabled),
    },
    {
      type: 'dockerhub' as RegistryType,
      label: 'Docker Hub',
      configured: !!(config.containerRegistries?.dockerHub?.username && config.containerRegistries.dockerHub.password && config.containerRegistries.dockerHub.enabled),
    },
  ];
}

/**
 * Create a registry instance for the given type
 */
export async function createRegistry(type: RegistryType, options?: Partial<RegistryPushRequest>): Promise<ContainerRegistry> {
  const config = await getConfig();

  switch (type) {
    case 'daytona':
      return new DaytonaRegistry(options?.regionId);

    case 'ecr': {
      const aws = config.cloudBackends?.aws;
      if (!aws?.accessKeyId || !aws?.secretAccessKey) {
        throw new Error('AWS credentials not configured. Configure AWS in Cloud Backends settings.');
      }
      return new EcrRegistry(aws.accessKeyId, aws.secretAccessKey, options?.ecrRegion || aws.region);
    }

    case 'gcr': {
      const gcp = config.cloudBackends?.gcp;
      if (!gcp?.projectId || !gcp?.keyFileJson) {
        throw new Error('GCP credentials not configured. Configure GCP in Cloud Backends settings.');
      }
      return new GcrRegistry(gcp.projectId, gcp.keyFileJson, options?.gcrHostname);
    }

    case 'acr': {
      const azure = config.cloudBackends?.azure;
      if (!azure?.clientId || !azure?.clientSecret || !azure?.tenantId) {
        throw new Error('Azure credentials not configured. Configure Azure in Cloud Backends settings.');
      }
      if (!options?.acrLoginServer) {
        throw new Error('ACR login server is required (e.g. myregistry.azurecr.io)');
      }
      return new AcrRegistry(azure.clientId, azure.clientSecret, azure.tenantId, options.acrLoginServer);
    }

    case 'dockerhub': {
      const dh = config.containerRegistries?.dockerHub;
      if (!dh?.username || !dh?.password) {
        throw new Error('Docker Hub credentials not configured. Configure in Cloud Backends settings.');
      }
      return new DockerHubRegistry(dh.username, dh.password);
    }

    default:
      throw new Error(`Unknown registry type: ${type}`);
  }
}
