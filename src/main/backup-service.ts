import { createHash, randomUUID } from 'node:crypto';
import {
  ApplyImportResult,
  BackupFile,
  Category,
  DeletedCustomFieldTombstone,
  DeletedRecordTombstone,
  ImportConflictStrategy,
  ImportDuplicateCandidate,
  ImportPreview,
  ImportPreviewItem,
  ImportResolution,
  PlainCustomField,
  PlainRecord,
  VaultSnapshot,
} from './contracts';
import { VaultService } from './vault-service';

const BACKUP_VERSION = 1;

interface AppliedImportPlan extends ApplyImportResult {
  snapshot: VaultSnapshot;
  adoptVaultId: boolean;
}

export class BackupService {
  constructor(private readonly vault: VaultService) {}

  createBackupFileObject(): BackupFile {
    const snapshot = this.buildSnapshotWithHash(this.vault.buildSnapshot());
    const serializedSnapshot = serializeCanonical(snapshot);
    const crypto = this.vault.getCryptoService();
    const { key, salt, iterations } = crypto.deriveBackupKey();

    return {
      version: BACKUP_VERSION,
      vaultId: snapshot.vaultId,
      exportedAt: snapshot.exportedAt,
      contentHash: snapshot.contentHash,
      kdf: {
        algorithm: 'PBKDF2-SHA256',
        salt,
        iterations,
      },
      payload: crypto.encryptWithKey(serializedSnapshot, key),
    };
  }

  createBackupFileText(): string {
    return JSON.stringify(this.createBackupFileObject(), null, 2);
  }

  parseBackupFile(raw: string): BackupFile {
    const parsed = JSON.parse(raw) as BackupFile;
    if (parsed.version !== BACKUP_VERSION) {
      throw new Error(`Unsupported backup version: ${parsed.version}`);
    }
    if (!parsed.kdf?.salt || !parsed.payload || !parsed.vaultId) {
      throw new Error('Backup file is incomplete');
    }
    return parsed;
  }

  decryptBackupFile(raw: string): VaultSnapshot {
    const file = this.parseBackupFile(raw);
    const crypto = this.vault.getCryptoService();
    const { key } = crypto.deriveBackupKey(file.kdf.salt, file.kdf.iterations);
    const snapshotRaw = crypto.decryptWithKey(file.payload, key);
    const snapshot = JSON.parse(snapshotRaw) as VaultSnapshot;

    const rebuilt = this.buildSnapshotWithHash(snapshot);
    if (rebuilt.contentHash !== file.contentHash) {
      throw new Error('Backup content hash mismatch');
    }
    return rebuilt;
  }

  previewImportFile(raw: string, fileName: string): ImportPreview {
    const remote = this.decryptBackupFile(raw);
    const local = this.buildSnapshotWithHash(this.vault.buildSnapshot());
    return buildImportPreview(local, remote, fileName);
  }

  applyImportFile(raw: string, resolutions: ImportResolution[]): ApplyImportResult {
    const remote = this.decryptBackupFile(raw);
    const local = this.buildSnapshotWithHash(this.vault.buildSnapshot());
    const preview = buildImportPreview(local, remote, '');
    const applied = applyImportPlan(
      local,
      remote,
      preview,
      resolutions,
      this.vault.getDeviceId(),
    );
    this.vault.applySnapshot(applied.snapshot, { adoptVaultId: applied.adoptVaultId });

    return {
      importedCount: applied.importedCount,
      overwrittenCount: applied.overwrittenCount,
      mergedCount: applied.mergedCount,
      skippedCount: applied.skippedCount,
      keptBothCount: applied.keptBothCount,
      contentHash: applied.contentHash,
    };
  }

  importBackupFile(raw: string): { mergedRecords: number; adoptedVaultId: boolean; contentHash: string } {
    const remote = this.decryptBackupFile(raw);
    const local = this.buildSnapshotWithHash(this.vault.buildSnapshot());

    const localEmpty = this.vault.isVaultEmpty();
    if (!localEmpty && remote.vaultId !== local.vaultId) {
      throw new Error('当前保险库与导入文件不属于同一个 vault，已阻止导入。');
    }

    const merged = mergeSnapshots(localEmpty ? emptySnapshot(remote.vaultId, local.categories) : local, remote);
    const adoptVaultId = localEmpty && remote.vaultId !== local.vaultId;
    this.vault.applySnapshot(merged, { adoptVaultId });

    return {
      mergedRecords: merged.records.length,
      adoptedVaultId: adoptVaultId,
      contentHash: merged.contentHash,
    };
  }

  buildSnapshotWithHash(snapshot: VaultSnapshot): VaultSnapshot {
    const normalized: VaultSnapshot = {
      version: snapshot.version,
      vaultId: snapshot.vaultId,
      exportedAt: snapshot.exportedAt,
      contentHash: '',
      categories: [...snapshot.categories].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
      records: snapshot.records
        .map((record) => ({
          ...record,
          customFields: [...record.customFields].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      deletedRecords: [...snapshot.deletedRecords].sort((left, right) => left.recordId.localeCompare(right.recordId)),
      deletedCustomFields: [...snapshot.deletedCustomFields].sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
    };

    normalized.contentHash = logicalContentHash(normalized);
    return normalized;
  }
}

export function buildImportPreview(local: VaultSnapshot, remote: VaultSnapshot, fileName: string): ImportPreview {
  const localEmpty = local.records.length === 0 && local.deletedRecords.length === 0 && local.deletedCustomFields.length === 0;
  const sameVault = localEmpty || local.vaultId === remote.vaultId;
  const items = remote.records
    .map((record) => buildImportPreviewItem(local.records, record))
    .sort((left, right) => left.name.localeCompare(right.name));

  const duplicateCount = items.filter((item) => item.status === 'duplicate').length;
  const sameIdConflictCount = items.filter((item) => item.status === 'same-id-conflict').length;
  const unchangedCount = items.filter((item) => item.status === 'unchanged').length;
  const newCount = items.filter((item) => item.status === 'new').length;

  const warnings: string[] = [];
  if (!sameVault && !localEmpty) {
    warnings.push('该备份来自另一个 vault。此次导入会按“记录导入”处理，不会把对方的删除标记直接应用到当前库。');
  }
  if (remote.deletedRecords.length > 0 && !sameVault) {
    warnings.push(`备份里包含 ${remote.deletedRecords.length} 条删除记录，但跨 vault 导入不会同步这些删除标记。`);
  }
  if (duplicateCount > 0) {
    warnings.push(`检测到 ${duplicateCount} 条疑似重复记录，建议在导入前逐条确认处理策略。`);
  }

  return {
    fileName,
    sourceVaultId: remote.vaultId,
    targetVaultId: local.vaultId,
    sameVault,
    localEmpty,
    totalRecords: remote.records.length,
    newCount,
    unchangedCount,
    sameIdConflictCount,
    duplicateCount,
    deletedRecordCount: remote.deletedRecords.length,
    warnings,
    items,
  };
}

export function applyImportPlan(
  local: VaultSnapshot,
  remote: VaultSnapshot,
  preview: ImportPreview,
  resolutions: ImportResolution[],
  deviceId: string,
): AppliedImportPlan {
  const localEmpty = preview.localEmpty;
  const sameVault = preview.sameVault;
  const now = new Date().toISOString();

  const baseSnapshot = sameVault
    ? mergeSnapshots(localEmpty ? emptySnapshot(remote.vaultId, mergeCategories(local.categories, remote.categories)) : local, remote)
    : createBaseImportSnapshot(local, remote);

  const localRecordMap = new Map(local.records.map((record) => [record.id, cloneRecord(record)]));
  const remoteRecordMap = new Map(remote.records.map((record) => [record.id, cloneRecord(record)]));
  const itemMap = new Map(preview.items.map((item) => [item.importRecordId, item]));
  const resolutionMap = new Map(resolutions.map((entry) => [entry.importRecordId, entry]));
  const recordMap = new Map(baseSnapshot.records.map((record) => [record.id, cloneRecord(record)]));
  const deletedRecordMap = new Map(baseSnapshot.deletedRecords.map((entry) => [entry.recordId, { ...entry }]));
  const deletedFieldMap = new Map(baseSnapshot.deletedCustomFields.map((entry) => [entry.fieldId, { ...entry }]));

  let importedCount = 0;
  let overwrittenCount = 0;
  let mergedCount = 0;
  let skippedCount = 0;
  let keptBothCount = 0;

  for (const item of preview.items) {
    const remoteRecord = remoteRecordMap.get(item.importRecordId);
    if (!remoteRecord) {
      continue;
    }

    if (item.status === 'unchanged') {
      skippedCount += 1;
      continue;
    }

    if (item.status === 'new') {
      if (!sameVault) {
        const imported = stampImportedRecord(remoteRecord, deviceId, now, { keepRecordId: !recordMap.has(remoteRecord.id) });
        recordMap.set(imported.id, imported);
      }
      importedCount += 1;
      continue;
    }

    const resolution = resolutionMap.get(item.importRecordId) ?? defaultResolution(item);
    const effectiveTargetId = resolution.targetLocalRecordId || item.duplicateCandidates[0]?.localRecordId;

    if (item.status === 'same-id-conflict') {
      const localRecord = localRecordMap.get(remoteRecord.id);
      if (!localRecord) {
        continue;
      }

      if (resolution.strategy === 'skip') {
        recordMap.set(localRecord.id, cloneRecord(localRecord));
        restoreRecordVisibility(localRecord.id, deletedRecordMap, deletedFieldMap);
        skippedCount += 1;
        continue;
      }

      if (resolution.strategy === 'keep-both') {
        recordMap.set(localRecord.id, cloneRecord(localRecord));
        const imported = stampImportedRecord(remoteRecord, deviceId, now, { keepRecordId: false });
        recordMap.set(imported.id, imported);
        importedCount += 1;
        keptBothCount += 1;
        continue;
      }

      if (resolution.strategy === 'merge-fields') {
        recordMap.set(localRecord.id, mergeImportedRecord(localRecord, remoteRecord, localRecord.id, deviceId, now));
        restoreRecordVisibility(localRecord.id, deletedRecordMap, deletedFieldMap);
        mergedCount += 1;
        continue;
      }

      recordMap.set(localRecord.id, overwriteImportedRecord(localRecord, remoteRecord, localRecord.id, deviceId, now));
      restoreRecordVisibility(localRecord.id, deletedRecordMap, deletedFieldMap);
      overwrittenCount += 1;
      continue;
    }

    const targetLocalRecord = effectiveTargetId ? localRecordMap.get(effectiveTargetId) ?? recordMap.get(effectiveTargetId) : undefined;

    if (resolution.strategy === 'skip') {
      if (sameVault) {
        removeImportedRecord(remoteRecord.id, recordMap, deletedRecordMap, deletedFieldMap);
      }
      skippedCount += 1;
      continue;
    }

    if (resolution.strategy === 'keep-both' || !targetLocalRecord) {
      if (!sameVault) {
        const imported = stampImportedRecord(remoteRecord, deviceId, now, { keepRecordId: !recordMap.has(remoteRecord.id) });
        recordMap.set(imported.id, imported);
      }
      importedCount += 1;
      keptBothCount += 1;
      continue;
    }

    if (resolution.strategy === 'merge-fields') {
      recordMap.set(targetLocalRecord.id, mergeImportedRecord(targetLocalRecord, remoteRecord, targetLocalRecord.id, deviceId, now));
      if (sameVault) {
        removeImportedRecord(remoteRecord.id, recordMap, deletedRecordMap, deletedFieldMap);
      }
      restoreRecordVisibility(targetLocalRecord.id, deletedRecordMap, deletedFieldMap);
      mergedCount += 1;
      continue;
    }

    recordMap.set(targetLocalRecord.id, overwriteImportedRecord(targetLocalRecord, remoteRecord, targetLocalRecord.id, deviceId, now));
    if (sameVault) {
      removeImportedRecord(remoteRecord.id, recordMap, deletedRecordMap, deletedFieldMap);
    }
    restoreRecordVisibility(targetLocalRecord.id, deletedRecordMap, deletedFieldMap);
    overwrittenCount += 1;
  }

  pruneDeletedFieldTombstones(recordMap, deletedFieldMap);

  const snapshot: VaultSnapshot = {
    version: Math.max(local.version, remote.version),
    vaultId: sameVault ? (localEmpty ? remote.vaultId : local.vaultId) : local.vaultId,
    exportedAt: new Date().toISOString(),
    contentHash: '',
    categories: mergeCategories(local.categories, remote.categories),
    records: [...recordMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
    deletedRecords: [...deletedRecordMap.values()].sort((left, right) => left.recordId.localeCompare(right.recordId)),
    deletedCustomFields: [...deletedFieldMap.values()].sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
  };
  snapshot.contentHash = logicalContentHash(snapshot);

  return {
    snapshot,
    adoptVaultId: sameVault && localEmpty && remote.vaultId !== local.vaultId,
    importedCount,
    overwrittenCount,
    mergedCount,
    skippedCount,
    keptBothCount,
    contentHash: snapshot.contentHash,
  };
}

export function mergeSnapshots(local: VaultSnapshot, remote: VaultSnapshot): VaultSnapshot {
  const categories = mergeCategories(local.categories, remote.categories);
  const recordById = new Map<string, PlainRecord>();
  const localRecords = new Map(local.records.map((record) => [record.id, record]));
  const remoteRecords = new Map(remote.records.map((record) => [record.id, record]));
  const localDeleted = new Map(local.deletedRecords.map((record) => [record.recordId, record]));
  const remoteDeleted = new Map(remote.deletedRecords.map((record) => [record.recordId, record]));
  const mergedDeletedRecords = new Map<string, DeletedRecordTombstone>();

  const allRecordIds = new Set<string>([
    ...localRecords.keys(),
    ...remoteRecords.keys(),
    ...localDeleted.keys(),
    ...remoteDeleted.keys(),
  ]);

  for (const recordId of allRecordIds) {
    const chosenRecord = newerRecord(localRecords.get(recordId), remoteRecords.get(recordId));
    const chosenDelete = newerDelete(localDeleted.get(recordId), remoteDeleted.get(recordId));

    if (chosenDelete && (!chosenRecord || compareVersion(chosenDelete.deletedAt, chosenDelete.deviceId, chosenRecord.updatedAt, chosenRecord.updatedByDeviceId) >= 0)) {
      mergedDeletedRecords.set(recordId, chosenDelete);
      continue;
    }

    if (!chosenRecord) {
      continue;
    }

    const localFieldMap = new Map((localRecords.get(recordId)?.customFields ?? []).map((field) => [field.id, field]));
    const remoteFieldMap = new Map((remoteRecords.get(recordId)?.customFields ?? []).map((field) => [field.id, field]));
    const localDeletedFields = new Map(
      local.deletedCustomFields.filter((field) => field.recordId === recordId).map((field) => [field.fieldId, field]),
    );
    const remoteDeletedFields = new Map(
      remote.deletedCustomFields.filter((field) => field.recordId === recordId).map((field) => [field.fieldId, field]),
    );

    const allFieldIds = new Set<string>([
      ...localFieldMap.keys(),
      ...remoteFieldMap.keys(),
      ...localDeletedFields.keys(),
      ...remoteDeletedFields.keys(),
    ]);

    const mergedFields: PlainCustomField[] = [];
    for (const fieldId of allFieldIds) {
      const chosenField = newerField(localFieldMap.get(fieldId), remoteFieldMap.get(fieldId));
      const chosenFieldDelete = newerCustomFieldDelete(localDeletedFields.get(fieldId), remoteDeletedFields.get(fieldId));
      if (chosenFieldDelete && (!chosenField || compareVersion(chosenFieldDelete.deletedAt, chosenFieldDelete.deviceId, chosenField.updatedAt, chosenField.updatedByDeviceId) >= 0)) {
        continue;
      }
      if (chosenField) {
        mergedFields.push(chosenField);
      }
    }

    recordById.set(recordId, {
      ...chosenRecord,
      customFields: mergedFields.sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
    });
  }

  const deletedCustomFields = new Map<string, DeletedCustomFieldTombstone>();
  for (const tombstone of [...local.deletedCustomFields, ...remote.deletedCustomFields]) {
    if (mergedDeletedRecords.has(tombstone.recordId)) {
      deletedCustomFields.set(tombstone.fieldId, tombstone);
      continue;
    }

    const existing = deletedCustomFields.get(tombstone.fieldId);
    if (!existing || compareVersion(tombstone.deletedAt, tombstone.deviceId, existing.deletedAt, existing.deviceId) > 0) {
      deletedCustomFields.set(tombstone.fieldId, tombstone);
    }
  }

  const merged: VaultSnapshot = {
    version: Math.max(local.version, remote.version),
    vaultId: remote.vaultId || local.vaultId,
    exportedAt: new Date().toISOString(),
    contentHash: '',
    categories,
    records: [...recordById.values()].sort((left, right) => left.id.localeCompare(right.id)),
    deletedRecords: [...mergedDeletedRecords.values()].sort((left, right) => left.recordId.localeCompare(right.recordId)),
    deletedCustomFields: [...deletedCustomFields.values()].sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
  };

  merged.contentHash = logicalContentHash(merged);
  return merged;
}

export function serializeCanonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function createBaseImportSnapshot(local: VaultSnapshot, remote: VaultSnapshot): VaultSnapshot {
  const snapshot: VaultSnapshot = {
    version: Math.max(local.version, remote.version),
    vaultId: local.vaultId,
    exportedAt: new Date().toISOString(),
    contentHash: '',
    categories: mergeCategories(local.categories, remote.categories),
    records: local.records.map(cloneRecord),
    deletedRecords: local.deletedRecords.map((entry) => ({ ...entry })),
    deletedCustomFields: local.deletedCustomFields.map((entry) => ({ ...entry })),
  };
  snapshot.contentHash = logicalContentHash(snapshot);
  return snapshot;
}

function emptySnapshot(vaultId: string, categories: Category[]): VaultSnapshot {
  return {
    version: 1,
    vaultId,
    exportedAt: new Date().toISOString(),
    contentHash: '',
    categories,
    records: [],
    deletedRecords: [],
    deletedCustomFields: [],
  };
}

function buildImportPreviewItem(localRecords: PlainRecord[], remoteRecord: PlainRecord): ImportPreviewItem {
  const sameIdRecord = localRecords.find((record) => record.id === remoteRecord.id);
  if (sameIdRecord) {
    const unchanged = areRecordsEquivalent(sameIdRecord, remoteRecord);
    return {
      importRecordId: remoteRecord.id,
      name: remoteRecord.name,
      account: remoteRecord.account,
      address: remoteRecord.address,
      categoryId: remoteRecord.categoryId,
      status: unchanged ? 'unchanged' : 'same-id-conflict',
      matchedBy: ['recordId'],
      duplicateCandidates: [{
        localRecordId: sameIdRecord.id,
        name: sameIdRecord.name,
        account: sameIdRecord.account,
        address: sameIdRecord.address,
        matchedBy: ['recordId'],
      }],
      suggestedStrategy: unchanged
        ? 'skip'
        : (compareVersion(remoteRecord.updatedAt, remoteRecord.updatedByDeviceId, sameIdRecord.updatedAt, sameIdRecord.updatedByDeviceId) >= 0
          ? 'overwrite'
          : 'merge-fields'),
    };
  }

  const duplicateCandidates = findDuplicateCandidates(localRecords, remoteRecord);
  if (duplicateCandidates.length > 0) {
    return {
      importRecordId: remoteRecord.id,
      name: remoteRecord.name,
      account: remoteRecord.account,
      address: remoteRecord.address,
      categoryId: remoteRecord.categoryId,
      status: 'duplicate',
      matchedBy: duplicateCandidates[0].matchedBy,
      duplicateCandidates,
      suggestedStrategy: duplicateCandidates.length === 1 ? 'merge-fields' : 'keep-both',
    };
  }

  return {
    importRecordId: remoteRecord.id,
    name: remoteRecord.name,
    account: remoteRecord.account,
    address: remoteRecord.address,
    categoryId: remoteRecord.categoryId,
    status: 'new',
    matchedBy: [],
    duplicateCandidates: [],
  };
}

function defaultResolution(item: ImportPreviewItem): ImportResolution {
  return {
    importRecordId: item.importRecordId,
    strategy: item.suggestedStrategy ?? 'keep-both',
    targetLocalRecordId: item.duplicateCandidates[0]?.localRecordId,
  };
}

function findDuplicateCandidates(localRecords: PlainRecord[], remoteRecord: PlainRecord): ImportDuplicateCandidate[] {
  const remoteName = normalizeComparableText(remoteRecord.name);
  const remoteAccount = normalizeComparableText(remoteRecord.account);
  const remoteHost = normalizeComparableText(safeHost(remoteRecord.address));

  return localRecords
    .map((localRecord) => {
      const matchedBy: string[] = [];

      if (remoteAccount && remoteAccount === normalizeComparableText(localRecord.account)) {
        matchedBy.push('账号');
      }
      if (remoteHost && remoteHost === normalizeComparableText(safeHost(localRecord.address))) {
        matchedBy.push('地址');
      }
      if (remoteName && remoteName === normalizeComparableText(localRecord.name)) {
        matchedBy.push('名称');
      }

      return {
        candidate: localRecord,
        matchedBy,
        score: matchedBy.length === 0
          ? 0
          : matchedBy.reduce((sum, field) => sum + (field === '账号' ? 5 : field === '地址' ? 4 : 3), 0),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.candidate.name.localeCompare(right.candidate.name))
    .map(({ candidate, matchedBy }) => ({
      localRecordId: candidate.id,
      name: candidate.name,
      account: candidate.account,
      address: candidate.address,
      matchedBy,
    }));
}

function normalizeComparableText(value?: string): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/www\./g, '')
    .replace(/[\/?#].*$/g, '')
    .replace(/\s+/g, '');
}

function safeHost(address?: string): string {
  if (!address) {
    return '';
  }
  try {
    const normalized = address.startsWith('http') ? address : `https://${address}`;
    return new URL(normalized).hostname;
  } catch {
    return address.split('/')[0] || address;
  }
}

function areRecordsEquivalent(left: PlainRecord, right: PlainRecord): boolean {
  return serializeCanonical({
    ...left,
    updatedAt: '',
    updatedByDeviceId: '',
    createdAt: '',
    lastUsedAt: '',
  }) === serializeCanonical({
    ...right,
    updatedAt: '',
    updatedByDeviceId: '',
    createdAt: '',
    lastUsedAt: '',
  });
}

function cloneRecord(record: PlainRecord): PlainRecord {
  return {
    ...record,
    customFields: record.customFields.map((field) => ({ ...field })),
  };
}

function stampImportedRecord(
  record: PlainRecord,
  deviceId: string,
  now: string,
  options?: { keepRecordId?: boolean },
): PlainRecord {
  const nextRecordId = options?.keepRecordId ? record.id : randomUUID();
  return {
    ...record,
    id: nextRecordId,
    createdAt: record.createdAt || now,
    updatedAt: now,
    updatedByDeviceId: deviceId,
    customFields: record.customFields.map((field, index) => ({
      ...field,
      id: randomUUID(),
      recordId: nextRecordId,
      sortOrder: field.sortOrder ?? index,
      createdAt: field.createdAt || now,
      updatedAt: now,
      updatedByDeviceId: deviceId,
    })),
  };
}

function overwriteImportedRecord(
  localRecord: PlainRecord,
  remoteRecord: PlainRecord,
  targetRecordId: string,
  deviceId: string,
  now: string,
): PlainRecord {
  const keepFieldIds = targetRecordId === remoteRecord.id;
  return {
    ...remoteRecord,
    id: targetRecordId,
    createdAt: localRecord.createdAt,
    updatedAt: now,
    updatedByDeviceId: deviceId,
    lastUsedAt: localRecord.lastUsedAt,
    customFields: remoteRecord.customFields.map((field, index) => ({
      ...field,
      id: keepFieldIds ? field.id : randomUUID(),
      recordId: targetRecordId,
      sortOrder: index,
      createdAt: keepFieldIds ? field.createdAt : now,
      updatedAt: now,
      updatedByDeviceId: deviceId,
    })),
  };
}

function mergeImportedRecord(
  localRecord: PlainRecord,
  remoteRecord: PlainRecord,
  targetRecordId: string,
  deviceId: string,
  now: string,
): PlainRecord {
  const fieldByName = new Map<string, PlainCustomField>();
  for (const field of localRecord.customFields) {
    fieldByName.set(field.fieldName.trim().toLowerCase(), { ...field, recordId: targetRecordId });
  }

  for (const field of remoteRecord.customFields) {
    const key = field.fieldName.trim().toLowerCase();
    const existing = fieldByName.get(key);
    if (!existing) {
      fieldByName.set(key, {
        ...field,
        id: randomUUID(),
        recordId: targetRecordId,
        createdAt: now,
        updatedAt: now,
        updatedByDeviceId: deviceId,
      });
      continue;
    }

    if (!existing.fieldValue && field.fieldValue) {
      fieldByName.set(key, {
        ...existing,
        fieldValue: field.fieldValue,
        updatedAt: now,
        updatedByDeviceId: deviceId,
      });
    }
  }

  return {
    ...localRecord,
    categoryId: localRecord.categoryId || remoteRecord.categoryId,
    name: localRecord.name || remoteRecord.name,
    address: localRecord.address || remoteRecord.address,
    account: localRecord.account || remoteRecord.account,
    password: localRecord.password || remoteRecord.password,
    key: localRecord.key || remoteRecord.key,
    icon: localRecord.icon || remoteRecord.icon,
    color: localRecord.color || remoteRecord.color,
    favorite: localRecord.favorite || remoteRecord.favorite,
    id: targetRecordId,
    createdAt: localRecord.createdAt,
    updatedAt: now,
    updatedByDeviceId: deviceId,
    customFields: [...fieldByName.values()]
      .map((field, index) => ({
        ...field,
        recordId: targetRecordId,
        sortOrder: index,
      }))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
  };
}

function removeImportedRecord(
  recordId: string,
  recordMap: Map<string, PlainRecord>,
  deletedRecordMap: Map<string, DeletedRecordTombstone>,
  deletedFieldMap: Map<string, DeletedCustomFieldTombstone>,
): void {
  recordMap.delete(recordId);
  deletedRecordMap.delete(recordId);
  for (const [fieldId, tombstone] of [...deletedFieldMap.entries()]) {
    if (tombstone.recordId === recordId) {
      deletedFieldMap.delete(fieldId);
    }
  }
}

function restoreRecordVisibility(
  recordId: string,
  deletedRecordMap: Map<string, DeletedRecordTombstone>,
  deletedFieldMap: Map<string, DeletedCustomFieldTombstone>,
): void {
  deletedRecordMap.delete(recordId);
  for (const [fieldId, tombstone] of [...deletedFieldMap.entries()]) {
    if (tombstone.recordId === recordId) {
      deletedFieldMap.delete(fieldId);
    }
  }
}

function pruneDeletedFieldTombstones(
  recordMap: Map<string, PlainRecord>,
  deletedFieldMap: Map<string, DeletedCustomFieldTombstone>,
): void {
  const activeFieldIds = new Set(
    [...recordMap.values()].flatMap((record) => record.customFields.map((field) => field.id)),
  );
  for (const [fieldId] of [...deletedFieldMap.entries()]) {
    if (activeFieldIds.has(fieldId)) {
      deletedFieldMap.delete(fieldId);
    }
  }
}

function mergeCategories(local: Category[], remote: Category[]): Category[] {
  const map = new Map<string, Category>();
  for (const category of [...local, ...remote]) {
    map.set(category.id, category);
  }
  return [...map.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
}

function newerRecord(left?: PlainRecord, right?: PlainRecord): PlainRecord | undefined {
  if (!left) return right;
  if (!right) return left;
  return compareVersion(left.updatedAt, left.updatedByDeviceId, right.updatedAt, right.updatedByDeviceId) >= 0 ? left : right;
}

function newerField(left?: PlainCustomField, right?: PlainCustomField): PlainCustomField | undefined {
  if (!left) return right;
  if (!right) return left;
  return compareVersion(left.updatedAt, left.updatedByDeviceId, right.updatedAt, right.updatedByDeviceId) >= 0 ? left : right;
}

function newerDelete(left?: DeletedRecordTombstone, right?: DeletedRecordTombstone): DeletedRecordTombstone | undefined {
  if (!left) return right;
  if (!right) return left;
  return compareVersion(left.deletedAt, left.deviceId, right.deletedAt, right.deviceId) >= 0 ? left : right;
}

function newerCustomFieldDelete(
  left?: DeletedCustomFieldTombstone,
  right?: DeletedCustomFieldTombstone,
): DeletedCustomFieldTombstone | undefined {
  if (!left) return right;
  if (!right) return left;
  return compareVersion(left.deletedAt, left.deviceId, right.deletedAt, right.deviceId) >= 0 ? left : right;
}

function compareVersion(leftTime: string, leftDeviceId: string, rightTime: string, rightDeviceId: string): number {
  const leftTimestamp = new Date(leftTime).getTime();
  const rightTimestamp = new Date(rightTime).getTime();
  if (leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }
  return leftDeviceId.localeCompare(rightDeviceId);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function logicalContentHash(snapshot: VaultSnapshot): string {
  return sha256(serializeCanonical({
    ...snapshot,
    exportedAt: '',
    contentHash: '',
  }));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, entry]) => [key, sortValue(entry)]),
    );
  }
  return value;
}
