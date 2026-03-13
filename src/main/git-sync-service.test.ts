import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BackupService } from './backup-service';
import { SyncSettings } from './contracts';
import { GitSyncService } from './git-sync-service';
import { VaultService } from './vault-service';

function createTempDir() {
  return mkdtempSync(path.join(tmpdir(), 'secure-vault-sync-'));
}

const testSyncBaseDir = path.join(tmpdir(), 'secure-vault-sync-base');

function createVaultDouble(initialConfig: SyncSettings | null = null, initialStatus: Record<string, unknown> = {}) {
  const state = {
    config: initialConfig,
    storedStatus: { ...initialStatus },
  };

  const vault = {
    getSyncSettings: vi.fn(() => state.config),
    setSyncSettings: vi.fn((settings: SyncSettings) => {
      state.config = settings;
    }),
    getStoredSyncStatus: vi.fn(() => state.storedStatus),
    setStoredSyncStatus: vi.fn((status: Record<string, unknown>) => {
      state.storedStatus = { ...status };
    }),
  };

  return {
    state,
    vault: vault as unknown as VaultService,
  };
}

function createBackupDouble() {
  return {
    importBackupFile: vi.fn(),
    createBackupFileText: vi.fn(),
    parseBackupFile: vi.fn(),
  } as unknown as BackupService;
}

describe('GitSyncService', () => {
  it('configures sync defaults and exposes the merged status', () => {
    const { state, vault } = createVaultDouble(null, {
      lastRunAt: '2026-03-11T00:00:00.000Z',
      lastSuccessAt: '2026-03-11T00:01:00.000Z',
    });
    const service = new GitSyncService(vault, createBackupDouble(), testSyncBaseDir);

    const status = service.configure({
      remoteUrl: 'https://example.com/repo.git',
      localDir: 'X:\\sync-dir',
    });

    expect(state.config).toEqual({
      remoteUrl: 'https://example.com/repo.git',
      localDir: 'X:\\sync-dir',
      branch: 'main',
      snapshotFileName: 'vault.svlt',
    });
    expect(status).toEqual({
      configured: true,
      lastRunAt: '2026-03-11T00:00:00.000Z',
      lastSuccessAt: '2026-03-11T00:01:00.000Z',
      lastError: undefined,
      localDir: 'X:\\sync-dir',
      branch: 'main',
      remoteUrl: 'https://example.com/repo.git',
      snapshotFileName: 'vault.svlt',
    });
  });

  it('rejects sync settings when remote and local point to the same folder', () => {
    const service = new GitSyncService(createVaultDouble().vault, createBackupDouble(), testSyncBaseDir);

    expect(() =>
      service.configure({
        remoteUrl: '.\\sync-dir',
        localDir: path.join(testSyncBaseDir, 'sync-dir'),
      }),
    ).toThrow('远程仓库地址和本地工作目录不能是同一个文件夹');
  });

  it('resolves relative local directories under the sync base directory', async () => {
    const dir = createTempDir();

    try {
      const config: SyncSettings = {
        remoteUrl: 'https://example.com/repo.git',
        branch: 'main',
        localDir: '.\\git-sync',
        snapshotFileName: 'vault.svlt',
      };
      const { vault } = createVaultDouble(config);
      const backup = createBackupDouble() as {
        importBackupFile: ReturnType<typeof vi.fn>;
        createBackupFileText: ReturnType<typeof vi.fn>;
        parseBackupFile: ReturnType<typeof vi.fn>;
      };
      backup.createBackupFileText.mockReturnValue('next-backup');
      backup.parseBackupFile.mockReturnValue({ contentHash: 'same-hash' });

      const service = new GitSyncService(vault, backup as unknown as BackupService, dir);
      (service as any).ensureRepository = vi.fn().mockResolvedValue(undefined);
      (service as any).pullRemote = vi.fn().mockResolvedValue(undefined);
      (service as any).runGit = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });

      await service.run();

      expect((service as any).ensureRepository).toHaveBeenCalledWith(path.resolve(dir, '.\\git-sync'), 'main', 'https://example.com/repo.git');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('imports an existing snapshot, writes a new one, and records a successful sync run', async () => {
    const dir = createTempDir();

    try {
      const config: SyncSettings = {
        remoteUrl: 'https://example.com/repo.git',
        branch: 'main',
        localDir: dir,
        snapshotFileName: 'vault.svlt',
      };
      const snapshotPath = path.join(dir, config.snapshotFileName);
      writeFileSync(snapshotPath, 'remote-backup', 'utf8');

      const { state, vault } = createVaultDouble(config);
      const backup = createBackupDouble() as {
        importBackupFile: ReturnType<typeof vi.fn>;
        createBackupFileText: ReturnType<typeof vi.fn>;
        parseBackupFile: ReturnType<typeof vi.fn>;
      };
      backup.createBackupFileText.mockReturnValue('next-backup');
      backup.parseBackupFile.mockImplementation((raw: string) => {
        if (raw === 'remote-backup') {
          return { contentHash: 'old-hash' };
        }
        if (raw === 'next-backup') {
          return { contentHash: 'new-hash' };
        }
        throw new Error(`Unexpected backup payload: ${raw}`);
      });

      const service = new GitSyncService(vault, backup as unknown as BackupService, testSyncBaseDir);
      const runGit = vi.fn(async (_localDir: string, args: string[]) => {
        if (args[0] === 'status') {
          return { stdout: 'M  vault.svlt', stderr: '' };
        }
        return { stdout: '', stderr: '' };
      });

      (service as any).ensureRepository = vi.fn().mockResolvedValue(undefined);
      (service as any).pullRemote = vi.fn().mockResolvedValue(undefined);
      (service as any).pushRemote = vi.fn().mockResolvedValue(undefined);
      (service as any).runGit = runGit;

      const status = await service.run();

      expect(backup.importBackupFile).toHaveBeenCalledWith('remote-backup');
      expect(readFileSync(snapshotPath, 'utf8')).toBe('next-backup');
      expect(runGit).toHaveBeenNthCalledWith(1, dir, ['add', 'vault.svlt']);
      expect(runGit).toHaveBeenNthCalledWith(2, dir, ['status', '--porcelain', '--', 'vault.svlt']);
      expect(runGit).toHaveBeenNthCalledWith(3, dir, ['commit', '-m', expect.stringMatching(/^sync: /)]);
      expect((service as any).pushRemote).toHaveBeenCalledWith(dir, 'main');
      expect(state.storedStatus.lastError).toBe('');
      expect(state.storedStatus.lastRunAt).toEqual(expect.any(String));
      expect(state.storedStatus.lastSuccessAt).toEqual(expect.any(String));
      expect(status.lastSuccessAt).toEqual(expect.any(String));
      expect(status.lastError).toBe('');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stores the last sync error when a run fails', async () => {
    const config: SyncSettings = {
      remoteUrl: 'https://example.com/repo.git',
      branch: 'main',
      localDir: 'X:\\missing-sync-dir',
      snapshotFileName: 'vault.svlt',
    };
    const { state, vault } = createVaultDouble(config);
    const service = new GitSyncService(vault, createBackupDouble(), testSyncBaseDir);

    (service as any).ensureRepository = vi.fn().mockRejectedValue(new Error('git init failed'));

    await expect(service.run()).rejects.toThrow('git init failed');
    expect(state.storedStatus.lastRunAt).toEqual(expect.any(String));
    expect(state.storedStatus.lastSuccessAt).toBeUndefined();
    expect(state.storedStatus.lastError).toBe('git init failed');
  });

  it('translates dubious ownership errors into user-facing guidance', () => {
    const service = new GitSyncService(createVaultDouble().vault, createBackupDouble(), testSyncBaseDir);

    const message = (service as any).describeGitError(
      'X:\\owned-by-other-user',
      ['checkout', '-B', 'main'],
      [
        'git checkout -B main',
        "fatal: detected dubious ownership in repository at 'X:/owned-by-other-user'",
      ].join('\n'),
    );

    expect(message).toContain('无法访问本地工作目录，因为这个文件夹属于另一个 Windows 用户');
    expect(message).toContain('处理方式：优先把“本地工作目录”改成相对路径');
  });

  it('adds command-scoped safe.directory for app-managed sync folders', () => {
    const service = new GitSyncService(createVaultDouble().vault, createBackupDouble(), 'X:\\portable\\user-data');

    expect((service as any).buildGitArgs('X:\\portable\\user-data\\git-sync', ['status'])).toEqual([
      '-c',
      'safe.directory=X:/portable/user-data/git-sync',
      'status',
    ]);
    expect((service as any).buildGitArgs('D:\\external-sync', ['status'])).toEqual(['status']);
  });
});
