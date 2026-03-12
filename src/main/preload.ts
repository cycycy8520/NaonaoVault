import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  initVault: (password: string) => ipcRenderer.invoke('crypto:init', password),
  verifyPassword: (password: string) => ipcRenderer.invoke('crypto:verify', password),
  checkInitialized: () => ipcRenderer.invoke('crypto:checkInitialized'),
  lockVault: () => ipcRenderer.invoke('crypto:lock'),
  generatePassword: (length?: number) => ipcRenderer.invoke('crypto:generatePassword', length),
  calculateStrength: (password: string) => ipcRenderer.invoke('crypto:calculateStrength', password),
  copySensitiveToClipboard: (text: string, clearAfterSeconds?: number) => ipcRenderer.invoke('clipboard:writeSensitive', text, clearAfterSeconds),
  openExternal: (target: string) => ipcRenderer.invoke('shell:openExternal', target),

  getRecords: () => ipcRenderer.invoke('records:getAll'),
  getRecord: (id: string) => ipcRenderer.invoke('records:getById', id),
  createRecord: (record: any) => ipcRenderer.invoke('records:create', record),
  updateRecord: (record: any) => ipcRenderer.invoke('records:update', record),
  deleteRecord: (id: string) => ipcRenderer.invoke('records:delete', id),
  searchRecords: (query: string, categoryId?: string) => ipcRenderer.invoke('records:search', query, categoryId),

  getCustomFields: (recordId: string) => ipcRenderer.invoke('customFields:getByRecordId', recordId),
  getCategories: () => ipcRenderer.invoke('categories:getAll'),
  getAuditLogs: (limit?: number) => ipcRenderer.invoke('auditLog:getRecent', limit),

  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),

  getAISettings: () => ipcRenderer.invoke('ai:getSettings'),
  setAISettings: (settings: any) => ipcRenderer.invoke('ai:setSettings', settings),
  testAIConnection: () => ipcRenderer.invoke('ai:testConnection'),
  captureDraft: (rawText: string) => ipcRenderer.invoke('ai:captureDraft', rawText),

  assistantQuery: (question: string) => ipcRenderer.invoke('assistant:query', question),
  revealSecret: (recordId: string, field: 'password' | 'key') => ipcRenderer.invoke('assistant:revealSecret', recordId, field),

  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  prepareImportBackup: () => ipcRenderer.invoke('backup:prepareImport'),
  applyImportBackup: (importId: string, resolutions: any[]) => ipcRenderer.invoke('backup:applyImport', importId, resolutions),
  discardImportBackup: (importId: string) => ipcRenderer.invoke('backup:discardImport', importId),

  getSyncStatus: () => ipcRenderer.invoke('sync:getStatus'),
  configureSync: (settings: any) => ipcRenderer.invoke('sync:configure', settings),
  runSync: () => ipcRenderer.invoke('sync:run'),
});

export interface API {
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
  initVault: (password: string) => Promise<{ success: boolean; error?: string }>;
  verifyPassword: (password: string) => Promise<{ valid: boolean; error?: string }>;
  checkInitialized: () => Promise<{ initialized: boolean }>;
  lockVault: () => Promise<{ success: boolean; error?: string }>;
  generatePassword: (length?: number) => Promise<{ success: boolean; password?: string; strength?: { score: number; label: string; color: string }; error?: string }>;
  calculateStrength: (password: string) => Promise<{ score: number; label: string; color: string }>;
  copySensitiveToClipboard: (text: string, clearAfterSeconds?: number) => Promise<{ success: boolean; clearAfterSeconds?: number; error?: string }>;
  openExternal: (target: string) => Promise<{ success: boolean; error?: string }>;
  getRecords: () => Promise<any[]>;
  getRecord: (id: string) => Promise<any>;
  createRecord: (record: any) => Promise<any>;
  updateRecord: (record: any) => Promise<any>;
  deleteRecord: (id: string) => Promise<any>;
  searchRecords: (query: string, categoryId?: string) => Promise<any[]>;
  getCustomFields: (recordId: string) => Promise<any[]>;
  getCategories: () => Promise<any[]>;
  getAuditLogs: (limit?: number) => Promise<any[]>;
  getSetting: (key: string) => Promise<any>;
  setSetting: (key: string, value: any) => Promise<any>;
  getAISettings: () => Promise<any>;
  setAISettings: (settings: any) => Promise<any>;
  testAIConnection: () => Promise<any>;
  captureDraft: (rawText: string) => Promise<any>;
  assistantQuery: (question: string) => Promise<any>;
  revealSecret: (recordId: string, field: 'password' | 'key') => Promise<any>;
  exportBackup: () => Promise<any>;
  importBackup: () => Promise<any>;
  prepareImportBackup: () => Promise<any>;
  applyImportBackup: (importId: string, resolutions: any[]) => Promise<any>;
  discardImportBackup: (importId: string) => Promise<any>;
  getSyncStatus: () => Promise<any>;
  configureSync: (settings: any) => Promise<any>;
  runSync: () => Promise<any>;
}

declare global {
  interface Window {
    api: API;
  }
}
