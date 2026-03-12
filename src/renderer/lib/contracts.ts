import { CustomField, Record } from '../store';

export interface AISettings {
  baseUrl: string;
  model: string;
  apiKey?: string;
  searchMode?: 'local' | 'extended';
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

export interface SyncSettings {
  remoteUrl: string;
  branch: string;
  localDir: string;
  snapshotFileName: string;
}

export interface SecuritySettings {
  autoLockMinutes: number;
  clipboardClearSeconds: number;
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

export interface AuditLogEntry {
  id: string;
  action: string;
  record_id?: string | null;
  details?: string | null;
  created_at: string;
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

export interface ExtractedCustomField {
  fieldName: string;
  fieldValue?: string;
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
  extraction: {
    address?: string;
    account?: string;
    password?: string;
    key?: string;
    customFields: ExtractedCustomField[];
    notes: string[];
  };
  usedModel: boolean;
  warnings: string[];
}

export interface CaptureBatchResult {
  rawText: string;
  drafts: CaptureDraftResult[];
  warnings: string[];
}

export function normalizeRecord(record: any): Record {
  return {
    id: record.id,
    categoryId: record.categoryId,
    name: record.name,
    address: record.address || '',
    account: record.account || '',
    password: record.password || '',
    key: record.key || '',
    icon: record.icon || '',
    color: record.color || '',
    favorite: Boolean(record.favorite),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt || '',
    updatedByDeviceId: record.updatedByDeviceId || '',
    customFields: normalizeCustomFields(record.customFields || []),
  };
}

export function normalizeCustomFields(fields: any[]): CustomField[] {
  return fields.map((field, index) => ({
    id: field.id,
    recordId: field.recordId,
    fieldName: field.fieldName,
    fieldValue: field.fieldValue || '',
    fieldType: field.fieldType || 'text',
    sortOrder: field.sortOrder ?? index,
    createdAt: field.createdAt,
    updatedAt: field.updatedAt,
    updatedByDeviceId: field.updatedByDeviceId || '',
  }));
}
