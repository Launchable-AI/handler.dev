/**
 * Azure Container Registry provider
 *
 * Uses Azure service principal credentials for docker login.
 */

import { execSync, spawn } from 'child_process';
import type { ContainerRegistry, RegistryPushResult, ProgressCallback, RegistryType } from './index.js';

export class AcrRegistry implements ContainerRegistry {
  readonly type: RegistryType = 'acr';

  constructor(
    private clientId: string,
    private clientSecret: string,
    private tenantId: string,
    private loginServer: string // e.g. myregistry.azurecr.io
  ) {}

  async login(): Promise<void> {
    // ACR supports SP login: docker login with clientId as username, clientSecret as password
    execSync(
      `echo "${this.clientSecret}" | docker login ${this.loginServer} -u ${this.clientId} --password-stdin`,
      { stdio: 'pipe' }
    );
  }

  getRemoteImageTag(_localImage: string, imageName: string): string {
    let cleanName = imageName;
    if (cleanName.includes(':')) cleanName = cleanName.split(':')[0];
    cleanName = cleanName.replace(/[^a-zA-Z0-9._/-]/g, '-');

    const versionTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${this.loginServer}/${cleanName}:${versionTag}`;
  }

  async push(localImage: string, imageName: string, onProgress: ProgressCallback): Promise<RegistryPushResult> {
    const remoteImage = this.getRemoteImageTag(localImage, imageName);

    onProgress(`Tagging ${localImage} as ${remoteImage}`, 'info');
    execSync(`docker tag ${localImage} ${remoteImage}`, { stdio: 'pipe' });

    onProgress(`Pushing ${remoteImage}...`, 'info');
    await this.dockerPush(remoteImage, onProgress);

    onProgress('Push complete!', 'info');

    return {
      registryType: 'acr',
      registryUrl: `https://${this.loginServer}`,
      remoteImage,
      pushedAt: new Date().toISOString(),
    };
  }

  async logout(): Promise<void> {
    try {
      execSync(`docker logout ${this.loginServer}`, { stdio: 'pipe' });
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
