import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import {
  Category,
  DeletedCustomFieldTombstone,
  DeletedRecordTombstone,
} from './contracts';

export interface RecordRow {
  id: string;
  name: string;
  address?: string | null;
  account?: string | null;
  password_encrypted?: string | null;
  key_encrypted?: string | null;
  category_id: string;
  icon?: string | null;
  color?: string | null;
  favorite: number;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
  updated_by_device_id: string;
}

export interface CustomFieldRow {
  id: string;
  record_id: string;
  field_name: string;
  field_value_encrypted?: string | null;
  field_type: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  updated_by_device_id: string;
}

export interface RecordRowInput {
  id?: string;
  name: string;
  address?: string | null;
  account?: string | null;
  password_encrypted?: string | null;
  key_encrypted?: string | null;
  category_id: string;
  icon?: string | null;
  color?: string | null;
  favorite?: number;
  created_at?: string;
  updated_at?: string;
  last_used_at?: string | null;
  updated_by_device_id: string;
}

export interface CustomFieldRowInput {
  id?: string;
  record_id: string;
  field_name: string;
  field_value_encrypted?: string | null;
  field_type?: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  updated_by_device_id: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  record_id?: string | null;
  details?: string | null;
  created_at: string;
}

export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        icon TEXT NOT NULL,
        color TEXT NOT NULL,
        sort_order INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS records (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT,
        account TEXT,
        password_encrypted TEXT,
        key_encrypted TEXT,
        category_id TEXT NOT NULL,
        icon TEXT,
        color TEXT,
        favorite INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used_at DATETIME,
        updated_by_device_id TEXT DEFAULT '',
        FOREIGN KEY (category_id) REFERENCES categories(id)
      );

      CREATE TABLE IF NOT EXISTS custom_fields (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_value_encrypted TEXT,
        field_type TEXT DEFAULT 'text',
        sort_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by_device_id TEXT DEFAULT '',
        FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS deleted_records (
        record_id TEXT PRIMARY KEY,
        deleted_at DATETIME NOT NULL,
        device_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS deleted_custom_fields (
        field_id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        deleted_at DATETIME NOT NULL,
        device_id TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        record_id TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.addColumnIfMissing('records', 'updated_by_device_id', "TEXT DEFAULT ''");
    this.addColumnIfMissing('custom_fields', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
    this.addColumnIfMissing('custom_fields', 'updated_by_device_id', "TEXT DEFAULT ''");

    this.initializeCategories();
  }

  private addColumnIfMissing(tableName: string, columnName: string, columnDefinition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === columnName)) {
      this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
    }
  }

  private initializeCategories(): void {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number };
    if (row.count > 0) {
      return;
    }

    const categories: Array<Omit<Category, 'sortOrder'> & { sortOrder: number }> = [
      { id: 'game-dev', name: '游戏开发', icon: '🎮', color: '#7C3AED', sortOrder: 1 },
      { id: 'ai-tools', name: 'AI工具', icon: '🤖', color: '#6366F1', sortOrder: 2 },
      { id: 'life', name: '生活', icon: '🏠', color: '#059669', sortOrder: 3 },
      { id: 'daily', name: '日常', icon: '📅', color: '#F59E0B', sortOrder: 4 },
      { id: 'work', name: '工作', icon: '💼', color: '#0EA5E9', sortOrder: 5 },
    ];

    const stmt = this.db.prepare(`
      INSERT INTO categories (id, name, icon, color, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const category of categories) {
      stmt.run(category.id, category.name, category.icon, category.color, category.sortOrder);
    }
  }

  getAllRecordRows(): RecordRow[] {
    return this.db
      .prepare('SELECT * FROM records ORDER BY updated_at DESC')
      .all() as RecordRow[];
  }

  getRecordRowById(id: string): RecordRow | undefined {
    return this.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as RecordRow | undefined;
  }

  getAllCustomFieldRows(): CustomFieldRow[] {
    return this.db
      .prepare('SELECT * FROM custom_fields ORDER BY sort_order, updated_at DESC')
      .all() as CustomFieldRow[];
  }

  getCustomFieldRowsByRecordId(recordId: string): CustomFieldRow[] {
    return this.db
      .prepare('SELECT * FROM custom_fields WHERE record_id = ? ORDER BY sort_order, created_at')
      .all(recordId) as CustomFieldRow[];
  }

  saveRecordGraph(record: RecordRowInput, customFields: CustomFieldRowInput[]): RecordRow {
    const save = this.db.transaction((payload: RecordRowInput, payloadFields: CustomFieldRowInput[]) => {
      const now = payload.updated_at ?? new Date().toISOString();
      const existing = payload.id ? this.getRecordRowById(payload.id) : undefined;
      const recordId = payload.id ?? uuidv4();
      const createdAt = payload.created_at ?? existing?.created_at ?? now;

      if (existing) {
        this.db.prepare(`
          UPDATE records
          SET name = ?, address = ?, account = ?, password_encrypted = ?, key_encrypted = ?,
              category_id = ?, icon = ?, color = ?, favorite = ?, updated_at = ?, last_used_at = ?,
              updated_by_device_id = ?
          WHERE id = ?
        `).run(
          payload.name,
          payload.address ?? null,
          payload.account ?? null,
          payload.password_encrypted ?? null,
          payload.key_encrypted ?? null,
          payload.category_id,
          payload.icon ?? null,
          payload.color ?? null,
          payload.favorite ?? 0,
          now,
          payload.last_used_at ?? null,
          payload.updated_by_device_id,
          recordId,
        );
      } else {
        this.db.prepare(`
          INSERT INTO records (
            id, name, address, account, password_encrypted, key_encrypted, category_id, icon, color,
            favorite, created_at, updated_at, last_used_at, updated_by_device_id
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          recordId,
          payload.name,
          payload.address ?? null,
          payload.account ?? null,
          payload.password_encrypted ?? null,
          payload.key_encrypted ?? null,
          payload.category_id,
          payload.icon ?? null,
          payload.color ?? null,
          payload.favorite ?? 0,
          createdAt,
          now,
          payload.last_used_at ?? null,
          payload.updated_by_device_id,
        );
      }

      this.db.prepare('DELETE FROM deleted_records WHERE record_id = ?').run(recordId);

      const existingFieldIds = new Set(
        this.getCustomFieldRowsByRecordId(recordId).map((field) => field.id),
      );
      const upsertedFieldIds = new Set<string>();

      for (const [index, field] of payloadFields.entries()) {
        const fieldId = field.id ?? uuidv4();
        const fieldCreatedAt = field.created_at ?? this.getCustomFieldRowsByRecordId(recordId)
          .find((item) => item.id === fieldId)?.created_at ?? now;
        const sortOrder = field.sort_order ?? index;

        if (existingFieldIds.has(fieldId)) {
          this.db.prepare(`
            UPDATE custom_fields
            SET field_name = ?, field_value_encrypted = ?, field_type = ?, sort_order = ?, updated_at = ?, updated_by_device_id = ?
            WHERE id = ?
          `).run(
            field.field_name,
            field.field_value_encrypted ?? null,
            field.field_type ?? 'text',
            sortOrder,
            field.updated_at ?? now,
            field.updated_by_device_id,
            fieldId,
          );
        } else {
          this.db.prepare(`
            INSERT INTO custom_fields (
              id, record_id, field_name, field_value_encrypted, field_type, sort_order,
              created_at, updated_at, updated_by_device_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            fieldId,
            recordId,
            field.field_name,
            field.field_value_encrypted ?? null,
            field.field_type ?? 'text',
            sortOrder,
            fieldCreatedAt,
            field.updated_at ?? now,
            field.updated_by_device_id,
          );
        }

        this.db.prepare('DELETE FROM deleted_custom_fields WHERE field_id = ?').run(fieldId);
        upsertedFieldIds.add(fieldId);
      }

      const removedFieldIds = [...existingFieldIds].filter((fieldId) => !upsertedFieldIds.has(fieldId));
      for (const removedFieldId of removedFieldIds) {
        const row = this.db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(removedFieldId) as CustomFieldRow | undefined;
        if (row) {
          this.insertDeletedCustomField({
            fieldId: removedFieldId,
            recordId: row.record_id,
            deletedAt: now,
            deviceId: payload.updated_by_device_id,
          });
        }
        this.db.prepare('DELETE FROM custom_fields WHERE id = ?').run(removedFieldId);
      }

      return this.getRecordRowById(recordId)!;
    });

    return save(record, customFields);
  }

  deleteRecord(id: string, deviceId: string): boolean {
    const remove = this.db.transaction((recordId: string, deletedBy: string) => {
      const record = this.getRecordRowById(recordId);
      if (!record) {
        return false;
      }

      const deletedAt = new Date().toISOString();
      const fieldRows = this.getCustomFieldRowsByRecordId(recordId);

      for (const fieldRow of fieldRows) {
        this.insertDeletedCustomField({
          fieldId: fieldRow.id,
          recordId: fieldRow.record_id,
          deletedAt,
          deviceId: deletedBy,
        });
      }

      this.db.prepare('DELETE FROM custom_fields WHERE record_id = ?').run(recordId);
      this.insertDeletedRecord({
        recordId,
        deletedAt,
        deviceId: deletedBy,
      });
      this.db.prepare('DELETE FROM records WHERE id = ?').run(recordId);
      return true;
    });

    return remove(id, deviceId);
  }

  searchRecordRows(query: string, categoryId?: string): RecordRow[] {
    const trimmed = query.trim();
    if (!trimmed) {
      return this.getAllRecordRows();
    }

    let sql = `
      SELECT DISTINCT records.*
      FROM records
      LEFT JOIN custom_fields ON custom_fields.record_id = records.id
      WHERE (
        records.name LIKE ?
        OR IFNULL(records.address, '') LIKE ?
        OR IFNULL(records.account, '') LIKE ?
        OR IFNULL(custom_fields.field_name, '') LIKE ?
      )
    `;
    const params: Array<string> = [`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`];

    if (categoryId) {
      sql += ' AND records.category_id = ?';
      params.push(categoryId);
    }

    sql += ' ORDER BY records.updated_at DESC';
    return this.db.prepare(sql).all(...params) as RecordRow[];
  }

  getAllCategories(): Category[] {
    const rows = this.db
      .prepare('SELECT id, name, icon, color, sort_order FROM categories ORDER BY sort_order')
      .all() as Array<{
      id: string;
      name: string;
      icon: string;
      color: string;
      sort_order: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      icon: row.icon,
      color: row.color,
      sortOrder: row.sort_order,
    }));
  }

  getDeletedRecords(): DeletedRecordTombstone[] {
    return this.db
      .prepare('SELECT record_id, deleted_at, device_id FROM deleted_records ORDER BY deleted_at DESC')
      .all()
      .map((row: any) => ({
        recordId: row.record_id,
        deletedAt: row.deleted_at,
        deviceId: row.device_id,
      })) as DeletedRecordTombstone[];
  }

  getDeletedCustomFields(): DeletedCustomFieldTombstone[] {
    return this.db
      .prepare('SELECT field_id, record_id, deleted_at, device_id FROM deleted_custom_fields ORDER BY deleted_at DESC')
      .all()
      .map((row: any) => ({
        fieldId: row.field_id,
        recordId: row.record_id,
        deletedAt: row.deleted_at,
        deviceId: row.device_id,
      })) as DeletedCustomFieldTombstone[];
  }

  replaceVaultState(state: {
    records: RecordRow[];
    customFields: CustomFieldRow[];
    deletedRecords: DeletedRecordTombstone[];
    deletedCustomFields: DeletedCustomFieldTombstone[];
  }): void {
    const replace = this.db.transaction((payload: typeof state) => {
      this.db.prepare('DELETE FROM custom_fields').run();
      this.db.prepare('DELETE FROM records').run();
      this.db.prepare('DELETE FROM deleted_custom_fields').run();
      this.db.prepare('DELETE FROM deleted_records').run();

      const insertRecord = this.db.prepare(`
        INSERT INTO records (
          id, name, address, account, password_encrypted, key_encrypted, category_id,
          icon, color, favorite, created_at, updated_at, last_used_at, updated_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertField = this.db.prepare(`
        INSERT INTO custom_fields (
          id, record_id, field_name, field_value_encrypted, field_type, sort_order,
          created_at, updated_at, updated_by_device_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const record of payload.records) {
        insertRecord.run(
          record.id,
          record.name,
          record.address ?? null,
          record.account ?? null,
          record.password_encrypted ?? null,
          record.key_encrypted ?? null,
          record.category_id,
          record.icon ?? null,
          record.color ?? null,
          record.favorite,
          record.created_at,
          record.updated_at,
          record.last_used_at ?? null,
          record.updated_by_device_id,
        );
      }

      for (const field of payload.customFields) {
        insertField.run(
          field.id,
          field.record_id,
          field.field_name,
          field.field_value_encrypted ?? null,
          field.field_type,
          field.sort_order,
          field.created_at,
          field.updated_at,
          field.updated_by_device_id,
        );
      }

      for (const tombstone of payload.deletedRecords) {
        this.insertDeletedRecord(tombstone);
      }

      for (const tombstone of payload.deletedCustomFields) {
        this.insertDeletedCustomField(tombstone);
      }
    });

    replace(state);
  }

  isVaultEmpty(): boolean {
    const counts = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM records) as records_count,
        (SELECT COUNT(*) FROM deleted_records) as deleted_records_count,
        (SELECT COUNT(*) FROM deleted_custom_fields) as deleted_custom_fields_count
    `).get() as {
      records_count: number;
      deleted_records_count: number;
      deleted_custom_fields_count: number;
    };

    return (
      counts.records_count === 0 &&
      counts.deleted_records_count === 0 &&
      counts.deleted_custom_fields_count === 0
    );
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value?: string } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value);
  }

  addAuditLog(action: string, recordId?: string, details?: string): void {
    this.db.prepare(`
      INSERT INTO audit_log (id, action, record_id, details, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuidv4(), action, recordId ?? null, details ?? null, new Date().toISOString());
  }

  getRecentAuditLogs(limit: number = 50): AuditLogEntry[] {
    return this.db
      .prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?')
      .all(limit) as AuditLogEntry[];
  }

  close(): void {
    this.db.close();
  }

  private insertDeletedRecord(tombstone: DeletedRecordTombstone): void {
    this.db.prepare(`
      INSERT INTO deleted_records (record_id, deleted_at, device_id)
      VALUES (?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id
    `).run(tombstone.recordId, tombstone.deletedAt, tombstone.deviceId);
  }

  private insertDeletedCustomField(tombstone: DeletedCustomFieldTombstone): void {
    this.db.prepare(`
      INSERT INTO deleted_custom_fields (field_id, record_id, deleted_at, device_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(field_id) DO UPDATE SET
        record_id = excluded.record_id,
        deleted_at = excluded.deleted_at,
        device_id = excluded.device_id
    `).run(tombstone.fieldId, tombstone.recordId, tombstone.deletedAt, tombstone.deviceId);
  }
}
