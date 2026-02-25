import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  createBuild,
  appendBuildLog,
  getBuildLogs,
  completeBuild,
  failBuild,
  getBuild,
  listBuilds,
  getActiveBuildByName,
  removeBuild,
} from '../build-tracker.js';

describe('build-tracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clean up any leftover builds
    for (const build of listBuilds()) {
      removeBuild(build.id);
    }
  });

  afterEach(() => {
    // Clean up builds created during tests
    for (const build of listBuilds()) {
      removeBuild(build.id);
    }
    vi.useRealTimers();
  });

  describe('createBuild', () => {
    it('creates a build with building status', () => {
      const build = createBuild('my-image');
      expect(build.status).toBe('building');
      expect(build.name).toBe('my-image');
      expect(build.id).toMatch(/^build-/);
      expect(build.startedAt).toBeDefined();
    });

    it('creates unique IDs for concurrent builds', () => {
      const a = createBuild('image-a');
      const b = createBuild('image-b');
      expect(a.id).not.toBe(b.id);
    });

    it('initializes empty log array', () => {
      const build = createBuild('test');
      expect(getBuildLogs(build.id)).toEqual([]);
    });
  });

  describe('appendBuildLog', () => {
    it('appends lines to build logs', () => {
      const build = createBuild('test');
      appendBuildLog(build.id, 'Step 1/5: FROM node');
      appendBuildLog(build.id, 'Step 2/5: COPY . .');
      expect(getBuildLogs(build.id)).toEqual([
        'Step 1/5: FROM node',
        'Step 2/5: COPY . .',
      ]);
    });

    it('rotates logs when exceeding MAX_LOG_LINES (5000)', () => {
      const build = createBuild('test');
      for (let i = 0; i < 5010; i++) {
        appendBuildLog(build.id, `line-${i}`);
      }
      const logs = getBuildLogs(build.id)!;
      expect(logs.length).toBe(5000);
      // First lines should have been trimmed
      expect(logs[0]).toBe('line-10');
      expect(logs[logs.length - 1]).toBe('line-5009');
    });

    it('no-ops for unknown build ID', () => {
      // Should not throw
      appendBuildLog('nonexistent', 'line');
    });
  });

  describe('completeBuild', () => {
    it('marks build as completed with container ID', () => {
      const build = createBuild('test');
      completeBuild(build.id, 'container-abc');

      const updated = getBuild(build.id)!;
      expect(updated.status).toBe('completed');
      expect(updated.containerId).toBe('container-abc');
      expect(updated.completedAt).toBeDefined();
    });

    it('cleans up after 10s delay', () => {
      const build = createBuild('test');
      completeBuild(build.id, 'ctr');

      // Still present before timeout
      expect(getBuild(build.id)).toBeDefined();

      vi.advanceTimersByTime(10_000);

      // Removed after timeout
      expect(getBuild(build.id)).toBeUndefined();
      expect(getBuildLogs(build.id)).toBeUndefined();
    });
  });

  describe('failBuild', () => {
    it('marks build as failed with error message', () => {
      const build = createBuild('test');
      failBuild(build.id, 'Dockerfile not found');

      const updated = getBuild(build.id)!;
      expect(updated.status).toBe('failed');
      expect(updated.error).toBe('Dockerfile not found');
      expect(updated.completedAt).toBeDefined();
    });

    it('cleans up after 60s delay', () => {
      const build = createBuild('test');
      failBuild(build.id, 'error');

      // Still present at 59s
      vi.advanceTimersByTime(59_000);
      expect(getBuild(build.id)).toBeDefined();

      // Removed at 60s
      vi.advanceTimersByTime(1_000);
      expect(getBuild(build.id)).toBeUndefined();
    });
  });

  describe('listBuilds', () => {
    it('returns all active builds', () => {
      createBuild('a');
      createBuild('b');
      createBuild('c');
      expect(listBuilds()).toHaveLength(3);
    });
  });

  describe('getActiveBuildByName', () => {
    it('finds an active build by name', () => {
      const build = createBuild('my-image');
      const found = getActiveBuildByName('my-image');
      expect(found?.id).toBe(build.id);
    });

    it('ignores completed builds', () => {
      const build = createBuild('my-image');
      completeBuild(build.id, 'ctr');
      expect(getActiveBuildByName('my-image')).toBeUndefined();
    });

    it('returns undefined for unknown name', () => {
      expect(getActiveBuildByName('nonexistent')).toBeUndefined();
    });
  });

  describe('removeBuild', () => {
    it('removes a build and its logs', () => {
      const build = createBuild('test');
      appendBuildLog(build.id, 'line');
      expect(removeBuild(build.id)).toBe(true);
      expect(getBuild(build.id)).toBeUndefined();
      expect(getBuildLogs(build.id)).toBeUndefined();
    });

    it('returns false for nonexistent build', () => {
      expect(removeBuild('nonexistent')).toBe(false);
    });
  });
});
