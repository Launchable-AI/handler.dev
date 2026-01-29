/**
 * Google Artifact Registry / Container Registry provider
 *
 * Uses GCP service account JSON key for docker login.
 */

import { execSync, spawn } from 'child_process';
import type { ContainerRegistry, RegistryPushResult, ProgressCallback, RegistryType } from './index.js';

export class GcrRegistry implements ContainerRegistry {
  readonly type: RegistryType = 'gcr';
  private hostname: string;

  constructor(
    private projectId: string,
    private keyFileJson: string,
    hostname?: string
  ) {
    // Default to Artifact Registry; users can override to gcr.io
    this.hostname = hostname || `us-docker.pkg.dev`;
  }

  async login(): Promise<void> {
    // Use the JSON key as the docker password with _json_key as username
    const key = this.keyFileJson.replace(/'/g, "'\\''");
    execSync(
      `echo '${key}' | docker login -u _json_key --password-stdin https://${this.hostname}`,
      { stdio: 'pipe' }
    );
  }

  getRemoteImageTag(_localImage: string, imageName: string): string {
    let cleanName = imageName;
    if (cleanName.includes(':')) cleanName = cleanName.split(':')[0];
    cleanName = cleanName.replace(/[^a-zA-Z0-9._/-]/g, '-');

    const versionTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // Artifact Registry format: HOSTNAME/PROJECT/REPOSITORY/IMAGE:TAG
    // We use the image name as both the repository and image name for simplicity
    return `${this.hostname}/${this.projectId}/${cleanName}:${versionTag}`;
  }

  async push(localImage: string, imageName: string, onProgress: ProgressCallback): Promise<RegistryPushResult> {
    const remoteImage = this.getRemoteImageTag(localImage, imageName);

    onProgress(`Tagging ${localImage} as ${remoteImage}`, 'info');
    execSync(`docker tag ${localImage} ${remoteImage}`, { stdio: 'pipe' });

    onProgress(`Pushing ${remoteImage}...`, 'info');
    await this.dockerPush(remoteImage, onProgress);

    onProgress('Push complete!', 'info');

    return {
      registryType: 'gcr',
      registryUrl: `https://${this.hostname}`,
      remoteImage,
      pushedAt: new Date().toISOString(),
    };
  }

  async logout(): Promise<void> {
    try {
      execSync(`docker logout https://${this.hostname}`, { stdio: 'pipe' });
    } catch {
      // Ignore
    }
  }

  private dockerPush(remoteImage: string, onProgress: ProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('docker', ['push', remoteImage], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data: Buffer) => {
        for (const line of data.toString().trim().split('\n')) {
          if (line.trim()) onProgress(line, 'progress');
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        for (const line of data.toString().trim().split('\n')) {
          if (line.trim()) onProgress(line, 'progress');
        }
      });

      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`docker push exited with code ${code}`));
      });

      proc.on('error', reject);
    });
  }
}
