/**
 * Docker Hub registry provider
 *
 * Uses username/password for docker login to Docker Hub.
 */

import { execFileSync, spawn } from 'child_process';
import type { ContainerRegistry, RegistryPushResult, ProgressCallback, RegistryType } from './index.js';

export class DockerHubRegistry implements ContainerRegistry {
  readonly type: RegistryType = 'dockerhub';

  constructor(
    private username: string,
    private password: string
  ) {}

  async login(): Promise<void> {
    execFileSync('docker', ['login', '-u', this.username, '--password-stdin'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      input: this.password,
    });
  }

  getRemoteImageTag(_localImage: string, imageName: string): string {
    let cleanName = imageName;
    if (cleanName.includes(':')) cleanName = cleanName.split(':')[0];
    cleanName = cleanName.replace(/[^a-zA-Z0-9._/-]/g, '-');

    const versionTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    // Docker Hub format: username/image:tag
    return `${this.username}/${cleanName}:${versionTag}`;
  }

  async push(localImage: string, imageName: string, onProgress: ProgressCallback): Promise<RegistryPushResult> {
    const remoteImage = this.getRemoteImageTag(localImage, imageName);

    onProgress(`Tagging ${localImage} as ${remoteImage}`, 'info');
    execFileSync('docker', ['tag', localImage, remoteImage], { stdio: 'pipe' });

    onProgress(`Pushing ${remoteImage}...`, 'info');
    await this.dockerPush(remoteImage, onProgress);

    onProgress('Push complete!', 'info');

    return {
      registryType: 'dockerhub',
      registryUrl: 'https://hub.docker.com',
      remoteImage,
      pushedAt: new Date().toISOString(),
    };
  }

  async logout(): Promise<void> {
    try {
      execFileSync('docker', ['logout'], { stdio: 'pipe' });
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
