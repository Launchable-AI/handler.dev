/**
 * Daytona registry provider
 *
 * Uses Daytona's temporary registry credentials to push images.
 */

import { execSync } from 'child_process';
import { spawn } from 'child_process';
import type { ContainerRegistry, RegistryPushResult, ProgressCallback, RegistryType } from './index.js';
import { getDaytonaService } from '../daytona.js';

export class DaytonaRegistry implements ContainerRegistry {
  readonly type: RegistryType = 'daytona';
  private registryUrl = '';
  private project = '';
  private username = '';
  private secret = '';

  constructor(private regionId?: string) {}

  async login(): Promise<void> {
    const service = getDaytonaService();
    await service.initialize();
    const access = await service.getRegistryPushAccess(this.regionId);
    this.registryUrl = access.registryUrl;
    this.project = access.project;
    this.username = access.username;
    this.secret = access.secret;

    execSync(
      `echo "${this.secret}" | docker login ${this.registryUrl} -u ${this.username} --password-stdin`,
      { stdio: 'pipe' }
    );
  }

  getRemoteImageTag(localImage: string, imageName: string): string {
    let cleanName = imageName;
    if (cleanName.includes('/')) cleanName = cleanName.split('/').pop() || cleanName;
    if (cleanName.includes(':')) cleanName = cleanName.split(':')[0];
    if (!cleanName.startsWith('handler-')) cleanName = `handler-${cleanName}`;

    const versionTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${this.registryUrl}/${this.project}/${cleanName}:${versionTag}`;
  }

  async push(localImage: string, imageName: string, onProgress: ProgressCallback): Promise<RegistryPushResult> {
    const remoteImage = this.getRemoteImageTag(localImage, imageName);

    onProgress(`Tagging ${localImage} as ${remoteImage}`, 'info');
    execSync(`docker tag ${localImage} ${remoteImage}`, { stdio: 'pipe' });

    onProgress(`Pushing ${remoteImage}...`, 'info');
    await this.dockerPush(remoteImage, onProgress);

    onProgress('Push complete!', 'info');

    return {
      registryType: 'daytona',
      registryUrl: this.registryUrl,
      remoteImage,
      pushedAt: new Date().toISOString(),
    };
  }

  async logout(): Promise<void> {
    if (this.registryUrl) {
      try {
        execSync(`docker logout ${this.registryUrl}`, { stdio: 'pipe' });
      } catch {
        // Ignore logout errors
      }
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
