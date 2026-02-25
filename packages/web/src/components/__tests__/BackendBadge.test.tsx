import { describe, it, expect } from 'vitest';
import { render, screen } from '../../test/test-utils';
import { BackendBadge, getBackendShortName } from '../sandbox/BackendBadge';
import type { SandboxBackend } from '../../api/client';

const ALL_BACKENDS: SandboxBackend[] = [
  'docker',
  'cloud-hypervisor',
  'firecracker',
  'daytona',
  'aws',
  'azure',
  'gcp',
  'digitalocean',
  'linode',
];

describe('BackendBadge', () => {
  it('renders all 9 backends without crashing', () => {
    for (const backend of ALL_BACKENDS) {
      const { unmount } = render(<BackendBadge backend={backend} />);
      unmount();
    }
  });

  it('shows the backend label as title attribute', () => {
    const { container } = render(<BackendBadge backend="docker" />);
    const badge = container.querySelector('span');
    expect(badge).toHaveAttribute('title', 'Docker');
  });

  it('renders SVG icon for docker (lucide icon)', () => {
    const { container } = render(<BackendBadge backend="docker" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('renders img element for icon-based backends', () => {
    const { container } = render(<BackendBadge backend="aws" />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img?.getAttribute('src')).toBe('/backends/aws.ico');
    expect(img?.getAttribute('alt')).toBe('AWS');
  });

  it('does not show label text by default', () => {
    const { container } = render(<BackendBadge backend="docker" />);
    const labelSpan = container.querySelector('span > span');
    expect(labelSpan).toBeNull();
  });

  it('shows label text when showLabel is true', () => {
    render(<BackendBadge backend="docker" showLabel />);
    expect(screen.getByText('Docker')).toBeTruthy();
  });

  it('applies small size classes by default', () => {
    const { container } = render(<BackendBadge backend="docker" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('h-3')).toBe(true);
    expect(svg?.classList.contains('w-3')).toBe(true);
  });

  it('applies medium size classes when size=md', () => {
    const { container } = render(<BackendBadge backend="docker" size="md" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('h-4')).toBe(true);
    expect(svg?.classList.contains('w-4')).toBe(true);
  });
});

describe('getBackendShortName', () => {
  const expected: Record<SandboxBackend, string> = {
    'docker': 'Docker',
    'cloud-hypervisor': 'CH',
    'firecracker': 'FC',
    'daytona': 'Daytona',
    'aws': 'AWS',
    'azure': 'Azure',
    'gcp': 'GCP',
    'digitalocean': 'DO',
    'linode': 'Linode',
  };

  for (const [backend, shortName] of Object.entries(expected)) {
    it(`returns "${shortName}" for ${backend}`, () => {
      expect(getBackendShortName(backend as SandboxBackend)).toBe(shortName);
    });
  }
});
