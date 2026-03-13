import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { SyncStatus } from './contracts';
import { BackupService } from './backup-service';
import { VaultService } from './vault-service';

const execFileAsync = promisify(execFile);
const WINDOWS_DRIVE_PATH_PATTERN = /^[a-z]:[\\/]/i;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\/;

function isLikelyLocalPath(value: string): boolean {
  const trimmed = value.trim();
  return (
    WINDOWS_DRIVE_PATH_PATTERN.test(trimmed) ||
    WINDOWS_UNC_PATH_PATTERN.test(trimmed) ||
    trimmed.startsWith('.') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('\\')
  );
}

function normalizeLocalPathForComparison(value: string): string {
  return path.resolve(value).replace(/[\\/]+/g, '/').toLowerCase();
}

function firstUsefulLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
}

export class GitSyncService {
  constructor(
    private readonly vault: VaultService,
    private readonly backupService: BackupService,
    private readonly syncBaseDir: string,
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
    const normalized = this.normalizeSyncSettings(settings);
    this.validateSyncSettings(normalized);
    this.vault.setSyncSettings(normalized);
    return this.getStatus();
  }

  async run(): Promise<SyncStatus> {
    const rawConfig = this.vault.getSyncSettings();
    if (!rawConfig) {
      throw new Error('请先在设置中配置 Git 同步。');
    }
    const config = this.normalizeSyncSettings(rawConfig);
    this.validateSyncSettings(config);
    const resolvedLocalDir = this.resolveLocalDir(config.localDir);

    const status = this.getStatus();
    const nextStatus: Record<string, any> = {
      ...status,
      lastRunAt: new Date().toISOString(),
      lastError: '',
    };

    try {
      if (!existsSync(resolvedLocalDir)) {
        mkdirSync(resolvedLocalDir, { recursive: true });
      }

      await this.ensureRepository(resolvedLocalDir, config.branch, config.remoteUrl);
      await this.pullRemote(resolvedLocalDir, config.branch);

      const snapshotPath = path.join(resolvedLocalDir, config.snapshotFileName);
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
        await this.runGit(resolvedLocalDir, ['add', config.snapshotFileName]);
        const changed = await this.runGit(resolvedLocalDir, ['status', '--porcelain', '--', config.snapshotFileName]);
        if (changed.stdout.trim()) {
          await this.runGit(resolvedLocalDir, ['commit', '-m', `sync: ${new Date().toISOString()}`]);
          await this.pushRemote(resolvedLocalDir, config.branch);
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
      return await execFileAsync('git', this.buildGitArgs(localDir, args), { cwd: localDir, windowsHide: true });
    } catch (error: any) {
      const stderr = error?.stderr || '';
      const stdout = error?.stdout || '';
      const detail = [`git ${args.join(' ')}`, stderr || stdout || error?.message || String(error)].filter(Boolean).join('\n');
      throw new Error(this.describeGitError(localDir, args, detail));
    }
  }

  private normalizeSyncSettings(settings: {
    remoteUrl: string;
    branch?: string;
    localDir: string;
    snapshotFileName?: string;
  }): { remoteUrl: string; branch: string; localDir: string; snapshotFileName: string } {
    return {
      remoteUrl: settings.remoteUrl.trim(),
      localDir: settings.localDir.trim(),
      branch: settings.branch?.trim() || 'main',
      snapshotFileName: settings.snapshotFileName?.trim() || 'vault.svlt',
    };
  }

  private validateSyncSettings(settings: {
    remoteUrl: string;
    branch: string;
    localDir: string;
    snapshotFileName: string;
  }): void {
    if (!settings.remoteUrl) {
      throw new Error('请先填写远程仓库地址。');
    }

    if (!settings.localDir) {
      throw new Error('请先填写本地工作目录。');
    }

    if (!settings.branch) {
      throw new Error('请先填写同步分支。');
    }

    if (!settings.snapshotFileName) {
      throw new Error('请先填写快照文件名。');
    }

    if (settings.snapshotFileName.includes('/') || settings.snapshotFileName.includes('\\')) {
      throw new Error('快照文件名只需要填写文件名，例如 `vault.svlt`，不要填写路径。');
    }

    const resolvedLocalDir = this.resolveLocalDir(settings.localDir);
    if (
      isLikelyLocalPath(settings.remoteUrl) &&
      this.resolveComparablePath(settings.remoteUrl) === normalizeLocalPathForComparison(resolvedLocalDir)
    ) {
      throw new Error(
        'Git 同步配置无效：远程仓库地址和本地工作目录不能是同一个文件夹。请把“远程仓库地址”改成 GitHub / Gitee 仓库地址，或另一个专门用于同步的仓库目录。',
      );
    }
  }

  private resolveLocalDir(localDir: string): string {
    if (path.isAbsolute(localDir)) {
      return path.resolve(localDir);
    }
    return path.resolve(this.syncBaseDir, localDir);
  }

  private resolveComparablePath(value: string): string {
    if (path.isAbsolute(value)) {
      return normalizeLocalPathForComparison(value);
    }
    return normalizeLocalPathForComparison(path.resolve(this.syncBaseDir, value));
  }

  private buildGitArgs(localDir: string, args: string[]): string[] {
    if (!this.shouldAutoTrustDirectory(localDir)) {
      return args;
    }
    return ['-c', `safe.directory=${localDir.replace(/\\/g, '/')}`, ...args];
  }

  private shouldAutoTrustDirectory(localDir: string): boolean {
    const normalizedBase = normalizeLocalPathForComparison(this.syncBaseDir);
    const normalizedLocalDir = normalizeLocalPathForComparison(localDir);
    return normalizedLocalDir === normalizedBase || normalizedLocalDir.startsWith(`${normalizedBase}/`);
  }

  private describeGitError(localDir: string, args: string[], rawMessage: string): string {
    const message = rawMessage.replace(/\r/g, '').trim();

    if (message.includes('detected dubious ownership')) {
      return [
        '无法访问本地工作目录，因为这个文件夹属于另一个 Windows 用户。',
        `目录：${localDir}`,
        '处理方式：优先把“本地工作目录”改成相对路径，例如 `./git-sync`，软件会把它放到当前应用数据目录下并自动做命令级放行；如果你坚持用外部目录，再考虑手动加入 Git 的 safe.directory 白名单。',
      ].join('\n');
    }

    if (message.includes('spawn git ENOENT')) {
      return '未检测到 Git。请先安装 Git，并确认 `git` 命令已加入系统 PATH。';
    }

    if (
      message.includes('Authentication failed') ||
      message.includes('Permission denied') ||
      message.includes('could not read Username') ||
      message.includes('terminal prompts disabled')
    ) {
      return '远程仓库认证失败。请先在系统 Git 中完成登录，或检查 SSH / Token 权限后再重试。';
    }

    if (
      message.includes('Repository not found') ||
      message.includes('does not appear to be a git repository') ||
      message.includes('not a git repository')
    ) {
      return '找不到远程仓库。请检查“远程仓库地址”是否填写正确，以及你是否有访问权限。';
    }

    if (
      message.includes('Could not resolve host') ||
      message.includes('Failed to connect') ||
      message.includes('Connection timed out')
    ) {
      return '连接远程仓库失败。请检查网络、代理设置，或稍后再试。';
    }

    if (message.includes('couldn\'t find remote ref') || message.includes('no such ref was fetched')) {
      return '远程分支不存在。请检查分支名称是否填写正确。';
    }

    const summary = firstUsefulLine(message);
    return [
      `Git 同步失败：${summary || `git ${args.join(' ')}`}`,
      '请检查仓库地址、登录状态和本地工作目录后重试。',
    ].join('\n');
  }
}
