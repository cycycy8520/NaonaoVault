import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { SyncStatus } from './contracts';
import { BackupService } from './backup-service';
import { VaultService } from './vault-service';

const execFileAsync = promisify(execFile);

export class GitSyncService {
  constructor(
    private readonly vault: VaultService,
    private readonly backupService: BackupService,
  ) {}

  getStatus(): SyncStatus {
    const config = this.vault.getSyncSettings();
    const stored = this.vault.getStoredSyncStatus();
    return {
      configured: Boolean(config),
      lastRunAt: stored.lastRunAt,
      lastSuccessAt: stored.lastSuccessAt,
      lastError: stored.lastError,
      localDir: config?.localDir,
      branch: config?.branch,
      remoteUrl: config?.remoteUrl,
      snapshotFileName: config?.snapshotFileName,
    };
  }

  configure(settings: { remoteUrl: string; branch?: string; localDir: string; snapshotFileName?: string }): SyncStatus {
    this.vault.setSyncSettings({
      remoteUrl: settings.remoteUrl,
      localDir: settings.localDir,
      branch: settings.branch || 'main',
      snapshotFileName: settings.snapshotFileName || 'vault.svlt',
    });
    return this.getStatus();
  }

  async run(): Promise<SyncStatus> {
    const config = this.vault.getSyncSettings();
    if (!config) {
      throw new Error('请先在设置中配置 Git 同步。');
    }

    const status = this.getStatus();
    const nextStatus: Record<string, any> = {
      ...status,
      lastRunAt: new Date().toISOString(),
      lastError: '',
    };

    try {
      if (!existsSync(config.localDir)) {
        mkdirSync(config.localDir, { recursive: true });
      }

      await this.ensureRepository(config.localDir, config.branch, config.remoteUrl);
      await this.pullRemote(config.localDir, config.branch);

      const snapshotPath = path.join(config.localDir, config.snapshotFileName);
      if (existsSync(snapshotPath)) {
        const remoteFile = readFileSync(snapshotPath, 'utf8');
        this.backupService.importBackupFile(remoteFile);
      }

      const nextBackupText = this.backupService.createBackupFileText();
      const currentContentHash = existsSync(snapshotPath)
        ? this.backupService.parseBackupFile(readFileSync(snapshotPath, 'utf8')).contentHash
        : '';
      const nextContentHash = this.backupService.parseBackupFile(nextBackupText).contentHash;

      if (currentContentHash !== nextContentHash) {
        writeFileSync(snapshotPath, nextBackupText, 'utf8');
        await this.runGit(config.localDir, ['add', config.snapshotFileName]);
        const changed = await this.runGit(config.localDir, ['status', '--porcelain', '--', config.snapshotFileName]);
        if (changed.stdout.trim()) {
          await this.runGit(config.localDir, ['commit', '-m', `sync: ${new Date().toISOString()}`]);
          await this.pushRemote(config.localDir, config.branch);
        }
      }

      nextStatus.lastSuccessAt = new Date().toISOString();
    } catch (error) {
      nextStatus.lastError = error instanceof Error ? error.message : String(error);
      this.vault.setStoredSyncStatus(nextStatus);
      throw error;
    }

    this.vault.setStoredSyncStatus(nextStatus);
    return this.getStatus();
  }

  private async ensureRepository(localDir: string, branch: string, remoteUrl: string): Promise<void> {
    if (!existsSync(path.join(localDir, '.git'))) {
      await this.runGit(localDir, ['init']);
    }

    await this.runGit(localDir, ['checkout', '-B', branch]);

    const remotes = await this.runGit(localDir, ['remote']);
    if (!remotes.stdout.split(/\r?\n/).includes('origin')) {
      await this.runGit(localDir, ['remote', 'add', 'origin', remoteUrl]);
    } else {
      await this.runGit(localDir, ['remote', 'set-url', 'origin', remoteUrl]);
    }
  }

  private async pullRemote(localDir: string, branch: string): Promise<void> {
    try {
      await this.runGit(localDir, ['pull', '--rebase', 'origin', branch]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.includes('couldn\'t find remote ref') ||
        message.includes('no such ref was fetched') ||
        message.includes('There is no tracking information for the current branch') ||
        message.includes('does not appear to be a git repository')
      ) {
        return;
      }
      throw error;
    }
  }

  private async pushRemote(localDir: string, branch: string): Promise<void> {
    try {
      await this.runGit(localDir, ['push', '-u', 'origin', branch]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('set-upstream')) {
        await this.runGit(localDir, ['push', '--set-upstream', 'origin', branch]);
        return;
      }
      throw error;
    }
  }

  private async runGit(localDir: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync('git', args, { cwd: localDir, windowsHide: true });
    } catch (error: any) {
      const stderr = error?.stderr || '';
      const stdout = error?.stdout || '';
      throw new Error([`git ${args.join(' ')}`, stderr || stdout || error?.message || String(error)].filter(Boolean).join('\n'));
    }
  }
}
