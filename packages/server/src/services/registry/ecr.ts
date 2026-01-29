/**
 * AWS ECR registry provider
 *
 * Uses AWS SDK to get auth tokens and auto-creates repos if missing.
 */

import { execSync, spawn } from 'child_process';
import type { ContainerRegistry, RegistryPushResult, ProgressCallback, RegistryType } from './index.js';

export class EcrRegistry implements ContainerRegistry {
  readonly type: RegistryType = 'ecr';
  private registryUrl = '';
  private accountId = '';

  constructor(
    private accessKeyId: string,
    private secretAccessKey: string,
    private region: string
  ) {}

  private getEnv(): Record<string, string> {
    return {
      ...process.env as Record<string, string>,
      AWS_ACCESS_KEY_ID: this.accessKeyId,
      AWS_SECRET_ACCESS_KEY: this.secretAccessKey,
      AWS_DEFAULT_REGION: this.region,
    };
  }

  async login(): Promise<void> {
    const env = this.getEnv();

    // Get account ID and registry URL
    const callerIdentity = execSync('aws sts get-caller-identity --output json', { env, stdio: ['pipe', 'pipe', 'pipe'] });
    const identity = JSON.parse(callerIdentity.toString());
    this.accountId = identity.Account;
    this.registryUrl = `${this.accountId}.dkr.ecr.${this.region}.amazonaws.com`;

    // Get auth token and login
    const tokenOutput = execSync(
      `aws ecr get-login-password --region ${this.region}`,
      { env, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const password = tokenOutput.toString().trim();

    execSync(
      `echo "${password}" | docker login --username AWS --password-stdin ${this.registryUrl}`,
      { stdio: 'pipe' }
    );
  }

  getRemoteImageTag(_localImage: string, imageName: string): string {
    let cleanName = imageName;
    if (cleanName.includes(':')) cleanName = cleanName.split(':')[0];
    // ECR repo names can contain slashes
    cleanName = cleanName.replace(/[^a-zA-Z0-9._/-]/g, '-');

    const versionTag = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${this.registryUrl}/${cleanName}:${versionTag}`;
  }

  async push(localImage: string, imageName: string, onProgress: ProgressCallback): Promise<RegistryPushResult> {
    const remoteImage = this.getRemoteImageTag(localImage, imageName);
    const repoName = imageName.includes(':') ? imageName.split(':')[0] : imageName;
    const cleanRepoName = repoName.replace(/[^a-zA-Z0-9._/-]/g, '-');

    // Auto-create repository if it doesn't exist
    onProgress(`Ensuring ECR repository "${cleanRepoName}" exists...`, 'info');
    try {
      execSync(
        `aws ecr describe-repositories --repository-names ${cleanRepoName} --region ${this.region}`,
        { env: this.getEnv(), stdio: 'pipe' }
      );
    } catch {
      onProgress(`Creating ECR repository "${cleanRepoName}"...`, 'info');
      execSync(
        `aws ecr create-repository --repository-name ${cleanRepoName} --region ${this.region}`,
        { env: this.getEnv(), stdio: 'pipe' }
      );
    }

    onProgress(`Tagging ${localImage} as ${remoteImage}`, 'info');
    execSync(`docker tag ${localImage} ${remoteImage}`, { stdio: 'pipe' });

    onProgress(`Pushing ${remoteImage}...`, 'info');
    await this.dockerPush(remoteImage, onProgress);

    onProgress('Push complete!', 'info');

    return {
      registryType: 'ecr',
      registryUrl: this.registryUrl,
      remoteImage,
      pushedAt: new Date().toISOString(),
    };
  }

  async logout(): Promise<void> {
    try {
      execSync(`docker logout ${this.registryUrl}`, { stdio: 'pipe' });
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
