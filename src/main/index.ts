import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DatabaseService } from './database';
import type { CryptoService } from './crypto';
import type { VaultService } from './vault-service';
import type { BackupService } from './backup-service';
import type { AIService } from './ai-service';
import type { GitSyncService } from './git-sync-service';

const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === 'true';
const startupLogPath =
  process.env.SECURE_VAULT_STARTUP_LOG === '1'
    ? path.join(process.env.APPDATA ?? process.env.TEMP ?? process.cwd(), 'secure-vault-startup.log')
    : null;

let mainWindow: BrowserWindow | null = null;
let db: DatabaseService;
let cryptoService: CryptoService;
let vaultService: VaultService;
let backupService: BackupService;
let aiService: AIService;
let gitSyncService: GitSyncService;
let sensitiveClipboardTimer: NodeJS.Timeout | null = null;
const pendingImportBackups = new Map<string, string>();

function writeStartupLog(message: string): void {
  if (!startupLogPath) {
    return;
  }

  try {
    mkdirSync(path.dirname(startupLogPath), { recursive: true });
    appendFileSync(startupLogPath, `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // noop
  }
}

writeStartupLog('Main process module loaded');

const appDataRoot = app.getPath('appData');
const legacyUserDataDir = path.join(appDataRoot, 'secure-vault');
const renamedUserDataDir = path.join(appDataRoot, 'naonao-vault');

function resolveDefaultUserDataDir(): string {
  const legacyDbPath = path.join(legacyUserDataDir, 'secure-vault.db');
  const renamedDbPath = path.join(renamedUserDataDir, 'secure-vault.db');

  if (existsSync(legacyDbPath)) {
    return legacyUserDataDir;
  }

  if (existsSync(renamedDbPath)) {
    return renamedUserDataDir;
  }

  return legacyUserDataDir;
}

const resolvedUserDataDir = process.env.SECURE_VAULT_USER_DATA_DIR || resolveDefaultUserDataDir();
if (resolvedUserDataDir) {
  mkdirSync(resolvedUserDataDir, { recursive: true });
  app.setPath('userData', resolvedUserDataDir);
  writeStartupLog(`Resolved userData path override: ${resolvedUserDataDir}`);
}

process.on('uncaughtException', (error) => {
  writeStartupLog(`uncaughtException: ${toErrorMessage(error)}`);
});

process.on('unhandledRejection', (reason) => {
  writeStartupLog(`unhandledRejection: ${toErrorMessage(reason)}`);
});

function createWindow(): void {
  writeStartupLog('Creating main window');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 680,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#FFFFFF',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isDev) {
    writeStartupLog('Loading renderer from dev server');
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    writeStartupLog(`Loading renderer file: ${path.join(__dirname, '../renderer/index.html')}`);
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (openExternalUrl(url)) {
      return { action: 'deny' };
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (url === currentUrl) {
      return;
    }

    if (openExternalUrl(url)) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    writeStartupLog(`Renderer load failed: code=${errorCode} description=${errorDescription} url=${validatedURL}`);
  });

  mainWindow.on('closed', () => {
    writeStartupLog('Main window closed');
    mainWindow = null;
  });
}

function setupMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'NaonaoVault',
      submenu: [
        { role: 'about', label: 'About NaonaoVault' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit NaonaoVault' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'toggleDevTools', label: 'Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual Size' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Fullscreen' },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
}

function setupIPC(): void {
  ipcMain.on('window-minimize', () => mainWindow?.minimize());
  ipcMain.on('window-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return;
    }
    mainWindow.maximize();
  });
  ipcMain.on('window-close', () => mainWindow?.close());

  ipcMain.handle('crypto:init', async (_event, password: string) => {
    try {
      return vaultService.initVault(password);
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('crypto:verify', async (_event, password: string) => {
    try {
      return vaultService.verifyPassword(password);
    } catch (error) {
      return { valid: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('crypto:checkInitialized', async () => ({
    initialized: vaultService.isInitialized(),
  }));

  ipcMain.handle('crypto:lock', async () => {
    try {
      vaultService.lock();
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('crypto:generatePassword', async (_event, length: number = 16) => {
    try {
      const password = cryptoService.generatePassword(length);
      return { success: true, password, strength: cryptoService.calculateStrength(password) };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('crypto:calculateStrength', async (_event, password: string) => {
    try {
      return cryptoService.calculateStrength(password);
    } catch {
      return { score: 0, label: '未知', color: '#999999' };
    }
  });

  ipcMain.handle('clipboard:writeSensitive', async (_event, text: string, clearAfterSeconds?: number) => {
    try {
      clipboard.writeText(text);

      const configuredSeconds = Number(db.getSetting('clipboardClearSeconds') ?? 30);
      const effectiveSeconds = normalizeDelaySeconds(
        typeof clearAfterSeconds === 'number' ? clearAfterSeconds : configuredSeconds,
        30,
      );

      scheduleSensitiveClipboardClear(text, effectiveSeconds);
      return { success: true, clearAfterSeconds: effectiveSeconds };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('shell:openExternal', async (_event, target: string) => {
    try {
      const normalized = normalizeExternalUrl(target);
      if (!normalized) {
        return { success: false, error: '无效链接' };
      }

      await shell.openExternal(normalized);
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('records:getAll', async () => {
    try {
      return vaultService.getAllRecords();
    } catch {
      return [];
    }
  });

  ipcMain.handle('records:getById', async (_event, id: string) => {
    try {
      return vaultService.getRecordById(id);
    } catch {
      return undefined;
    }
  });

  ipcMain.handle('records:search', async (_event, query: string, categoryId?: string) => {
    try {
      return vaultService.searchRecords(query, categoryId);
    } catch {
      return [];
    }
  });

  ipcMain.handle('records:create', async (_event, record: any) => {
    try {
      const created = vaultService.createRecord(record);
      return { success: true, record: created };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('records:update', async (_event, record: any) => {
    try {
      const updated = vaultService.updateRecord(record);
      return { success: true, record: updated };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('records:delete', async (_event, id: string) => {
    try {
      const deleted = vaultService.deleteRecord(id);
      return { success: deleted };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('categories:getAll', async () => vaultService.getCategories());

  ipcMain.handle('customFields:getByRecordId', async (_event, recordId: string) => {
    try {
      return vaultService.getRecordById(recordId)?.customFields ?? [];
    } catch {
      return [];
    }
  });

  ipcMain.handle('auditLog:getRecent', async (_event, limit: number = 50) => {
    try {
      return db.getRecentAuditLogs(limit);
    } catch {
      return [];
    }
  });

  ipcMain.handle('settings:get', async (_event, key: string) => db.getSetting(key));
  ipcMain.handle('settings:set', async (_event, key: string, value: any) => {
    db.setSetting(key, String(value));
    return { success: true };
  });

  ipcMain.handle('ai:getSettings', async () => {
    try {
      return { success: true, settings: vaultService.getAISettings() };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('ai:setSettings', async (_event, settings: any) => {
    try {
      vaultService.setAISettings(settings);
      return { success: true };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('ai:testConnection', async () => {
    try {
      return await aiService.testConnection();
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('ai:captureDraft', async (_event, rawText: string) => {
    try {
      return { success: true, draft: await aiService.captureDraft(rawText) };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('assistant:query', async (_event, question: string) => {
    try {
      return { success: true, result: await aiService.query(question) };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('assistant:revealSecret', async (_event, recordId: string, field: 'password' | 'key') => {
    try {
      return { success: true, value: vaultService.revealSecret(recordId, field) };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('backup:export', async () => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: '导出加密备份',
        defaultPath: `naonao-vault-${new Date().toISOString().slice(0, 10)}.svlt`,
        filters: [{ name: 'NaonaoVault Backup', extensions: ['svlt'] }],
      });
      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      const content = backupService.createBackupFileText();
      writeFileSync(filePath, content, 'utf8');
      const metadata = backupService.parseBackupFile(content);
      return { success: true, filePath, contentHash: metadata.contentHash };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('backup:import', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: '导入加密备份',
        filters: [{ name: 'NaonaoVault Backup', extensions: ['svlt'] }],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      const raw = readFileSync(filePaths[0], 'utf8');
      const result = backupService.importBackupFile(raw);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('backup:prepareImport', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: '导入加密备份',
        filters: [{ name: 'NaonaoVault Backup', extensions: ['svlt'] }],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) {
        return { success: false, canceled: true };
      }

      const filePath = filePaths[0];
      const raw = readFileSync(filePath, 'utf8');
      const preview = backupService.previewImportFile(raw, path.basename(filePath));
      const importId = randomUUID();
      pendingImportBackups.set(importId, raw);
      return { success: true, importId, preview };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('backup:applyImport', async (_event, importId: string, resolutions: any[]) => {
    try {
      const raw = pendingImportBackups.get(importId);
      if (!raw) {
        return { success: false, error: '导入会话已失效，请重新选择备份文件。' };
      }

      const result = backupService.applyImportFile(raw, Array.isArray(resolutions) ? resolutions : []);
      pendingImportBackups.delete(importId);
      return { success: true, ...result };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('backup:discardImport', async (_event, importId: string) => {
    pendingImportBackups.delete(importId);
    return { success: true };
  });

  ipcMain.handle('sync:getStatus', async () => {
    try {
      return { success: true, status: gitSyncService.getStatus() };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('sync:configure', async (_event, settings: any) => {
    try {
      const status = gitSyncService.configure(settings);
      return { success: true, status };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle('sync:run', async () => {
    try {
      const status = await gitSyncService.run();
      return { success: true, status };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizeDelaySeconds(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.round(value));
}

function normalizeExternalUrl(target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed) {
    return null;
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function openExternalUrl(target: string): boolean {
  const normalized = normalizeExternalUrl(target);
  if (!normalized) {
    return false;
  }

  void shell.openExternal(normalized);
  return true;
}

function scheduleSensitiveClipboardClear(expectedText: string, delaySeconds: number): void {
  if (sensitiveClipboardTimer) {
    clearTimeout(sensitiveClipboardTimer);
    sensitiveClipboardTimer = null;
  }

  if (delaySeconds <= 0) {
    return;
  }

  sensitiveClipboardTimer = setTimeout(() => {
    try {
      if (clipboard.readText() === expectedText) {
        clipboard.clear();
      }
    } catch {
      // noop
    } finally {
      sensitiveClipboardTimer = null;
    }
  }, delaySeconds * 1000);
}

async function initializeServices(): Promise<void> {
  writeStartupLog('Loading service modules');
  const [
    { DatabaseService },
    { CryptoService },
    { VaultService },
    { BackupService },
    { AIService },
    { GitSyncService },
  ] = await Promise.all([
    import('./database'),
    import('./crypto'),
    import('./vault-service'),
    import('./backup-service'),
    import('./ai-service'),
    import('./git-sync-service'),
  ]);

  const userDataPath = app.getPath('userData');
  writeStartupLog(`Resolved userData path: ${userDataPath}`);

  // Fresh packaged installs may not have a userData directory yet.
  mkdirSync(userDataPath, { recursive: true });
  writeStartupLog('Ensured userData directory exists');

  const dbPath = path.join(userDataPath, 'secure-vault.db');
  writeStartupLog(`Opening database at: ${dbPath}`);
  db = new DatabaseService(dbPath);
  writeStartupLog('Database initialized');
  cryptoService = new CryptoService();
  writeStartupLog('Crypto service initialized');
  vaultService = new VaultService(db, cryptoService);
  backupService = new BackupService(vaultService);
  aiService = new AIService(vaultService);
  gitSyncService = new GitSyncService(vaultService, backupService, userDataPath);
  writeStartupLog('Application services initialized');
}

async function bootstrapApp(): Promise<void> {
  try {
    writeStartupLog('Bootstrap started');
    await initializeServices();
    createWindow();
    setupMenu();
    setupIPC();
    writeStartupLog('Bootstrap completed');
  } catch (error) {
    writeStartupLog(`Bootstrap failed: ${toErrorMessage(error)}`);
    dialog.showErrorBox('NaonaoVault 启动失败', toErrorMessage(error));
    app.exit(1);
  }
}

app.whenReady().then(() => {
  writeStartupLog('app.whenReady resolved');
  void bootstrapApp();
});

app.on('before-quit', () => {
  try {
    if (sensitiveClipboardTimer) {
      clearTimeout(sensitiveClipboardTimer);
      sensitiveClipboardTimer = null;
    }
    vaultService?.lock();
    db?.close();
  } catch {
    // noop
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (!mainWindow) {
    createWindow();
  }
});
