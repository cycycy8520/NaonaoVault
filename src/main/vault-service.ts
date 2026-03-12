import {
  AISettings,
  PlainCustomField,
  PlainRecord,
  RecordInput,
  StoredAISettings,
  SyncSettings,
  VaultSnapshot,
} from './contracts';
import {
  CryptoService,
  VaultInitResult,
} from './crypto';
import {
  CustomFieldRow,
  CustomFieldRowInput,
  DatabaseService,
  RecordRow,
  RecordRowInput,
} from './database';

const SETTINGS_KEYS = {
  initialized: 'vaultInitialized',
  salt: 'vaultSalt',
  legacyVerifier: 'vaultKey',
  verifier: 'vaultVerifier',
  iterations: 'vaultIterations',
  version: 'vaultDataVersion',
  vaultId: 'vaultId',
  deviceId: 'deviceId',
  aiConfig: 'aiConfig',
  syncConfig: 'syncConfig',
  syncStatus: 'syncStatus',
};

const CURRENT_DATA_VERSION = '2';

export class VaultService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
  ) {}

  initVault(password: string): { success: boolean; error?: string } {
    if (this.isInitialized()) {
      return { success: false, error: 'Vault already initialized' };
    }

    const result = this.crypto.init(password);
    this.db.setSetting(SETTINGS_KEYS.salt, result.salt);
    this.db.setSetting(SETTINGS_KEYS.verifier, result.verifier);
    this.db.setSetting(SETTINGS_KEYS.iterations, String(result.iterations));
    this.db.setSetting(SETTINGS_KEYS.initialized, 'true');
    this.db.setSetting(SETTINGS_KEYS.version, CURRENT_DATA_VERSION);
    this.ensureVaultIdentity();
    return { success: true };
  }

  verifyPassword(password: string): { valid: boolean; error?: string } {
    const salt = this.db.getSetting(SETTINGS_KEYS.salt);
    const verifier = this.db.getSetting(SETTINGS_KEYS.verifier);
    const legacyVerifier = this.db.getSetting(SETTINGS_KEYS.legacyVerifier);
    const iterations = Number(this.db.getSetting(SETTINGS_KEYS.iterations) ?? 210000);
    if (!salt || (!verifier && !legacyVerifier)) {
      return { valid: false, error: 'Vault not initialized' };
    }

    if (verifier) {
      const result = this.crypto.verifyPassword(password, salt, verifier, iterations);
      if (!result.valid) {
        return { valid: false, error: '密码错误' };
      }
    } else {
      const legacyResult = this.crypto.verifyLegacyPassword(password, salt, legacyVerifier!);
      if (!legacyResult.valid) {
        return { valid: false, error: '密码错误' };
      }

      // Upgrade legacy vault metadata after a successful unlock.
      const upgraded = this.crypto.init(password, salt);
      this.db.setSetting(SETTINGS_KEYS.verifier, upgraded.verifier);
      this.db.setSetting(SETTINGS_KEYS.iterations, String(upgraded.iterations));
    }

    this.ensureVaultIdentity();
    this.migrateLegacySecretsIfNeeded();
    return { valid: true };
  }

  lock(): void {
    this.crypto.clear();
  }

  isInitialized(): boolean {
    return this.db.getSetting(SETTINGS_KEYS.initialized) === 'true';
  }

  isUnlocked(): boolean {
    return this.crypto.isInitialized();
  }

  getVaultId(): string {
    this.ensureVaultIdentity();
    return this.db.getSetting(SETTINGS_KEYS.vaultId)!;
  }

  getDeviceId(): string {
    this.ensureVaultIdentity();
    return this.db.getSetting(SETTINGS_KEYS.deviceId)!;
  }

  getAllRecords(): PlainRecord[] {
    return this.inflateRecords(this.db.getAllRecordRows());
  }

  getRecordById(id: string): PlainRecord | undefined {
    const row = this.db.getRecordRowById(id);
    if (!row) {
      return undefined;
    }
    return this.inflateRecord(row);
  }

  searchRecords(query: string, categoryId?: string): PlainRecord[] {
    return this.inflateRecords(this.db.searchRecordRows(query, categoryId));
  }

  createRecord(input: RecordInput): PlainRecord {
    this.requireUnlocked();
    const deviceId = this.getDeviceId();
    const row = this.db.saveRecordGraph(
      this.toRecordRowInput(input, deviceId),
      this.toCustomFieldRowInputs(input, undefined, deviceId),
    );
    this.db.addAuditLog('CREATE', row.id, JSON.stringify({ name: row.name }));
    return this.inflateRecord(row);
  }

  updateRecord(input: RecordInput): PlainRecord {
    this.requireUnlocked();
    if (!input.id) {
      throw new Error('Record ID is required');
    }
    const existing = this.db.getRecordRowById(input.id);
    if (!existing) {
      throw new Error('Record not found');
    }

    const deviceId = this.getDeviceId();
    const row = this.db.saveRecordGraph(
      this.toRecordRowInput(input, deviceId, existing),
      this.toCustomFieldRowInputs(input, input.id, deviceId, existing),
    );
    this.db.addAuditLog('UPDATE', row.id, JSON.stringify({ name: row.name }));
    return this.inflateRecord(row);
  }

  deleteRecord(id: string): boolean {
    const result = this.db.deleteRecord(id, this.getDeviceId());
    if (result) {
      this.db.addAuditLog('DELETE', id);
    }
    return result;
  }

  getCategories() {
    return this.db.getAllCategories();
  }

  revealSecret(recordId: string, field: 'password' | 'key'): string {
    const record = this.getRecordById(recordId);
    if (!record) {
      throw new Error('Record not found');
    }
    return field === 'password' ? record.password ?? '' : record.key ?? '';
  }

  getAISettings(): AISettings {
    const raw = this.db.getSetting(SETTINGS_KEYS.aiConfig);
    if (!raw) {
      return { baseUrl: '', model: '', apiKey: '', searchMode: 'extended' };
    }

    const parsed = JSON.parse(raw) as StoredAISettings;
    return {
      baseUrl: parsed.baseUrl ?? '',
      model: parsed.model ?? '',
      apiKey: parsed.apiKeyEncrypted ? this.crypto.decrypt(parsed.apiKeyEncrypted) : '',
      searchMode: parsed.searchMode === 'local' ? 'local' : 'extended',
    };
  }

  setAISettings(settings: AISettings): void {
    this.requireUnlocked();
    const payload: StoredAISettings = {
      baseUrl: settings.baseUrl.trim(),
      model: settings.model.trim(),
      apiKeyEncrypted: settings.apiKey?.trim() ? this.crypto.encrypt(settings.apiKey.trim()) : undefined,
      searchMode: settings.searchMode === 'local' ? 'local' : 'extended',
    };
    this.db.setSetting(SETTINGS_KEYS.aiConfig, JSON.stringify(payload));
  }

  getSyncSettings(): SyncSettings | null {
    const raw = this.db.getSetting(SETTINGS_KEYS.syncConfig);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<SyncSettings>;
    if (!parsed.remoteUrl || !parsed.localDir) {
      return null;
    }
    return {
      remoteUrl: parsed.remoteUrl,
      localDir: parsed.localDir,
      branch: parsed.branch || 'main',
      snapshotFileName: parsed.snapshotFileName || 'vault.svlt',
    };
  }

  setSyncSettings(settings: SyncSettings): void {
    const payload: SyncSettings = {
      remoteUrl: settings.remoteUrl.trim(),
      localDir: settings.localDir.trim(),
      branch: settings.branch.trim() || 'main',
      snapshotFileName: settings.snapshotFileName.trim() || 'vault.svlt',
    };
    this.db.setSetting(SETTINGS_KEYS.syncConfig, JSON.stringify(payload));
  }

  getStoredSyncStatus(): Record<string, any> {
    const raw = this.db.getSetting(SETTINGS_KEYS.syncStatus);
    return raw ? JSON.parse(raw) as Record<string, any> : {};
  }

  setStoredSyncStatus(status: Record<string, any>): void {
    this.db.setSetting(SETTINGS_KEYS.syncStatus, JSON.stringify(status));
  }

  buildSnapshot(): VaultSnapshot {
    this.requireUnlocked();
    const records = this.getAllRecords();
    return {
      version: 1,
      vaultId: this.getVaultId(),
      exportedAt: new Date().toISOString(),
      contentHash: '',
      categories: this.getCategories(),
      records,
      deletedRecords: this.db.getDeletedRecords(),
      deletedCustomFields: this.db.getDeletedCustomFields(),
    };
  }

  applySnapshot(snapshot: VaultSnapshot, options?: { adoptVaultId?: boolean }): void {
    this.requireUnlocked();

    const deviceId = this.getDeviceId();
    const recordRows: RecordRow[] = [];
    const fieldRows: CustomFieldRow[] = [];

    for (const record of snapshot.records) {
      const row = this.toRecordRowInput(
        {
          id: record.id,
          name: record.name,
          categoryId: record.categoryId,
          address: record.address,
          account: record.account,
          password: record.password,
          key: record.key,
          icon: record.icon,
          color: record.color,
          favorite: record.favorite,
          customFields: record.customFields.map((field) => ({
            id: field.id,
            fieldName: field.fieldName,
            fieldValue: field.fieldValue,
            fieldType: field.fieldType,
            sortOrder: field.sortOrder,
          })),
        },
        record.updatedByDeviceId || deviceId,
      );

      recordRows.push({
        id: row.id ?? record.id,
        name: row.name,
        category_id: row.category_id,
        address: row.address,
        account: row.account,
        password_encrypted: row.password_encrypted,
        key_encrypted: row.key_encrypted,
        icon: row.icon,
        color: row.color,
        favorite: row.favorite ?? 0,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        last_used_at: record.lastUsedAt ?? null,
        updated_by_device_id: record.updatedByDeviceId || deviceId,
      });

      for (const field of record.customFields) {
        fieldRows.push({
          id: field.id,
          record_id: record.id,
          field_name: field.fieldName,
          field_value_encrypted: field.fieldValue ? this.crypto.encrypt(field.fieldValue) : null,
          field_type: field.fieldType,
          sort_order: field.sortOrder,
          created_at: field.createdAt,
          updated_at: field.updatedAt,
          updated_by_device_id: field.updatedByDeviceId || record.updatedByDeviceId || deviceId,
        });
      }
    }

    this.db.replaceVaultState({
      records: recordRows,
      customFields: fieldRows,
      deletedRecords: snapshot.deletedRecords,
      deletedCustomFields: snapshot.deletedCustomFields,
    });

    if (options?.adoptVaultId) {
      this.db.setSetting(SETTINGS_KEYS.vaultId, snapshot.vaultId);
    }
  }

  isVaultEmpty(): boolean {
    return this.db.isVaultEmpty();
  }

  getCryptoService(): CryptoService {
    return this.crypto;
  }

  private requireUnlocked(): void {
    if (!this.crypto.isInitialized()) {
      throw new Error('Vault is locked');
    }
  }

  private ensureVaultIdentity(): void {
    if (!this.db.getSetting(SETTINGS_KEYS.vaultId)) {
      this.db.setSetting(SETTINGS_KEYS.vaultId, this.crypto.createVaultId());
    }
    if (!this.db.getSetting(SETTINGS_KEYS.deviceId)) {
      this.db.setSetting(SETTINGS_KEYS.deviceId, this.crypto.createDeviceId());
    }
  }

  private migrateLegacySecretsIfNeeded(): void {
    if (this.db.getSetting(SETTINGS_KEYS.version) === CURRENT_DATA_VERSION) {
      return;
    }

    const migratedRecords = this.db.getAllRecordRows().map((row) => ({
      ...row,
      password_encrypted: row.password_encrypted
        ? (this.crypto.isEncrypted(row.password_encrypted) ? row.password_encrypted : this.crypto.encrypt(row.password_encrypted))
        : row.password_encrypted,
      key_encrypted: row.key_encrypted
        ? (this.crypto.isEncrypted(row.key_encrypted) ? row.key_encrypted : this.crypto.encrypt(row.key_encrypted))
        : row.key_encrypted,
    }));

    const migratedFields = this.db.getAllCustomFieldRows().map((field) => ({
      ...field,
      field_value_encrypted: field.field_value_encrypted
        ? (this.crypto.isEncrypted(field.field_value_encrypted) ? field.field_value_encrypted : this.crypto.encrypt(field.field_value_encrypted))
        : field.field_value_encrypted,
    }));

    this.db.replaceVaultState({
      records: migratedRecords,
      customFields: migratedFields,
      deletedRecords: this.db.getDeletedRecords(),
      deletedCustomFields: this.db.getDeletedCustomFields(),
    });
    this.db.setSetting(SETTINGS_KEYS.version, CURRENT_DATA_VERSION);
  }

  private inflateRecords(rows: RecordRow[]): PlainRecord[] {
    return rows.map((row) => this.inflateRecord(row));
  }

  private inflateRecord(row: RecordRow): PlainRecord {
    const customFields = this.db.getCustomFieldRowsByRecordId(row.id).map((field) => this.inflateCustomField(field));
    return {
      id: row.id,
      name: row.name,
      categoryId: row.category_id,
      address: row.address ?? undefined,
      account: row.account ?? undefined,
      password: row.password_encrypted ? this.crypto.decrypt(row.password_encrypted) : undefined,
      key: row.key_encrypted ? this.crypto.decrypt(row.key_encrypted) : undefined,
      icon: row.icon ?? undefined,
      color: row.color ?? undefined,
      favorite: !!row.favorite,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsedAt: row.last_used_at ?? undefined,
      updatedByDeviceId: row.updated_by_device_id,
      customFields,
    };
  }

  private inflateCustomField(field: CustomFieldRow): PlainCustomField {
    return {
      id: field.id,
      recordId: field.record_id,
      fieldName: field.field_name,
      fieldValue: field.field_value_encrypted ? this.crypto.decrypt(field.field_value_encrypted) : undefined,
      fieldType: field.field_type,
      sortOrder: field.sort_order,
      createdAt: field.created_at,
      updatedAt: field.updated_at,
      updatedByDeviceId: field.updated_by_device_id,
    };
  }

  private toRecordRowInput(input: RecordInput, deviceId: string, existing?: RecordRow): RecordRowInput {
    const now = new Date().toISOString();
    return {
      id: input.id,
      name: input.name.trim(),
      category_id: input.categoryId,
      address: input.address?.trim() || null,
      account: input.account?.trim() || null,
      password_encrypted: input.password?.trim() ? this.crypto.encrypt(input.password.trim()) : null,
      key_encrypted: input.key?.trim() ? this.crypto.encrypt(input.key.trim()) : null,
      icon: input.icon?.trim() || existing?.icon || null,
      color: input.color?.trim() || existing?.color || null,
      favorite: input.favorite !== undefined
        ? (input.favorite ? 1 : 0)
        : (existing?.favorite ?? 0),
      created_at: existing?.created_at ?? now,
      updated_at: now,
      last_used_at: existing?.last_used_at ?? null,
      updated_by_device_id: deviceId,
    };
  }

  private toCustomFieldRowInputs(
    input: RecordInput,
    recordId: string | undefined,
    deviceId: string,
    existing?: RecordRow,
  ): CustomFieldRowInput[] {
    const now = new Date().toISOString();
    const existingFields = existing ? this.db.getCustomFieldRowsByRecordId(existing.id) : [];
    const effectiveRecordId = recordId ?? input.id ?? '';

    return (input.customFields ?? [])
      .filter((field) => field.fieldName.trim())
      .map((field, index) => {
        const previous = field.id ? existingFields.find((item) => item.id === field.id) : undefined;
        return {
          id: field.id,
          record_id: effectiveRecordId,
          field_name: field.fieldName.trim(),
          field_value_encrypted: field.fieldValue?.trim()
            ? this.crypto.encrypt(field.fieldValue.trim())
            : null,
          field_type: field.fieldType ?? previous?.field_type ?? 'text',
          sort_order: field.sortOrder ?? index,
          created_at: previous?.created_at ?? now,
          updated_at: now,
          updated_by_device_id: deviceId,
        };
      });
  }
}

export function isVaultInitResult(value: unknown): value is VaultInitResult {
  return typeof value === 'object' && value !== null && 'salt' in value;
}
