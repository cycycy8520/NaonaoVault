export {};

declare global {
  interface Window {
    api: {
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
    };
  }
}
