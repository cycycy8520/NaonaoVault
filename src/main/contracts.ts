export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  sortOrder: number;
}

export interface CustomFieldInput {
  id?: string;
  fieldName: string;
  fieldValue?: string;
  fieldType?: string;
  sortOrder?: number;
}

export interface RecordInput {
  id?: string;
  name: string;
  categoryId: string;
  address?: string;
  account?: string;
  password?: string;
  key?: string;
  icon?: string;
  color?: string;
  favorite?: boolean;
  customFields?: CustomFieldInput[];
}

export interface PlainCustomField {
  id: string;
  recordId: string;
  fieldName: string;
  fieldValue?: string;
  fieldType: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  updatedByDeviceId: string;
}

export interface PlainRecord {
  id: string;
  name: string;
  categoryId: string;
  address?: string;
  account?: string;
  password?: string;
  key?: string;
  icon?: string;
  color?: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  updatedByDeviceId: string;
  customFields: PlainCustomField[];
}

export interface DeletedRecordTombstone {
  recordId: string;
  deletedAt: string;
  deviceId: string;
}

export interface DeletedCustomFieldTombstone {
  fieldId: string;
  recordId: string;
  deletedAt: string;
  deviceId: string;
}

export interface VaultSnapshot {
  version: number;
  vaultId: string;
  exportedAt: string;
  contentHash: string;
  categories: Category[];
  records: PlainRecord[];
  deletedRecords: DeletedRecordTombstone[];
  deletedCustomFields: DeletedCustomFieldTombstone[];
}

export interface BackupFile {
  version: number;
  vaultId: string;
  exportedAt: string;
  contentHash: string;
  kdf: {
    algorithm: 'PBKDF2-SHA256';
    iterations: number;
    salt: string;
  };
  payload: string;
}

export type ImportConflictStatus = 'new' | 'unchanged' | 'same-id-conflict' | 'duplicate';
export type ImportConflictStrategy = 'skip' | 'overwrite' | 'keep-both' | 'merge-fields';

export interface ImportDuplicateCandidate {
  localRecordId: string;
  name: string;
  account?: string;
  address?: string;
  matchedBy: string[];
}

export interface ImportPreviewItem {
  importRecordId: string;
  name: string;
  account?: string;
  address?: string;
  categoryId: string;
  status: ImportConflictStatus;
  matchedBy: string[];
  duplicateCandidates: ImportDuplicateCandidate[];
  suggestedStrategy?: ImportConflictStrategy;
}

export interface ImportPreview {
  fileName: string;
  sourceVaultId: string;
  targetVaultId: string;
  sameVault: boolean;
  localEmpty: boolean;
  totalRecords: number;
  newCount: number;
  unchangedCount: number;
  sameIdConflictCount: number;
  duplicateCount: number;
  deletedRecordCount: number;
  warnings: string[];
  items: ImportPreviewItem[];
}

export interface ImportResolution {
  importRecordId: string;
  strategy: ImportConflictStrategy;
  targetLocalRecordId?: string;
}

export interface ApplyImportResult {
  importedCount: number;
  overwrittenCount: number;
  mergedCount: number;
  skippedCount: number;
  keptBothCount: number;
  contentHash: string;
}

export interface AISettings {
  baseUrl: string;
  model: string;
  apiKey?: string;
  searchMode?: 'local' | 'extended';
}

export interface StoredAISettings {
  baseUrl: string;
  model: string;
  apiKeyEncrypted?: string;
  searchMode?: 'local' | 'extended';
}

export interface SyncSettings {
  remoteUrl: string;
  branch: string;
  localDir: string;
  snapshotFileName: string;
}

export interface SyncStatus {
  configured: boolean;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  localDir?: string;
  branch?: string;
  remoteUrl?: string;
  snapshotFileName?: string;
}

export interface ExtractedCustomField {
  fieldName: string;
  fieldValue?: string;
}

export interface CaptureExtraction {
  address?: string;
  account?: string;
  password?: string;
  key?: string;
  customFields: ExtractedCustomField[];
  notes: string[];
}

export interface CaptureDraft {
  name: string;
  categoryId: string;
  address?: string;
  account?: string;
  password?: string;
  key?: string;
  customFields: ExtractedCustomField[];
  reasoning?: string;
}

export interface CaptureDraftResult {
  rawText: string;
  draft: CaptureDraft;
  extraction: CaptureExtraction;
  usedModel: boolean;
  warnings: string[];
}

export interface CaptureBatchResult {
  rawText: string;
  drafts: CaptureDraftResult[];
  warnings: string[];
}

export interface AssistantMatch {
  recordId: string;
  name: string;
  address?: string;
  account?: string;
  categoryId: string;
  categoryName?: string;
  hasPassword: boolean;
  hasKey: boolean;
  matchedFields: string[];
}

export interface AssistantQueryResult {
  answer: string;
  results: AssistantMatch[];
  usedModel: boolean;
}
