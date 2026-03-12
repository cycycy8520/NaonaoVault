type TableRow = Record<string, any>;

type TableName =
  | 'categories'
  | 'records'
  | 'custom_fields'
  | 'deleted_records'
  | 'deleted_custom_fields'
  | 'settings'
  | 'audit_log';

const TABLE_COLUMNS: Record<TableName, string[]> = {
  categories: ['id', 'name', 'icon', 'color', 'sort_order', 'created_at'],
  records: [
    'id',
    'name',
    'address',
    'account',
    'password_encrypted',
    'key_encrypted',
    'category_id',
    'icon',
    'color',
    'favorite',
    'created_at',
    'updated_at',
    'last_used_at',
    'updated_by_device_id',
  ],
  custom_fields: [
    'id',
    'record_id',
    'field_name',
    'field_value_encrypted',
    'field_type',
    'sort_order',
    'created_at',
    'updated_at',
    'updated_by_device_id',
  ],
  deleted_records: ['record_id', 'deleted_at', 'device_id'],
  deleted_custom_fields: ['field_id', 'record_id', 'deleted_at', 'device_id'],
  settings: ['key', 'value', 'updated_at'],
  audit_log: ['id', 'action', 'record_id', 'details', 'created_at'],
};

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function cloneRow<T extends TableRow>(row: T | undefined): T | undefined {
  return row ? { ...row } : undefined;
}

function compareIsoDesc(left: string | undefined, right: string | undefined): number {
  return String(right ?? '').localeCompare(String(left ?? ''));
}

class FakeStatement {
  constructor(
    private readonly database: FakeBetterSqlite3,
    private readonly sql: string,
  ) {}

  all(...args: any[]) {
    return this.database.execute('all', this.sql, args);
  }

  get(...args: any[]) {
    return this.database.execute('get', this.sql, args);
  }

  run(...args: any[]) {
    return this.database.execute('run', this.sql, args);
  }
}

export default class FakeBetterSqlite3 {
  private readonly tables = {
    categories: new Map<string, TableRow>(),
    records: new Map<string, TableRow>(),
    custom_fields: new Map<string, TableRow>(),
    deleted_records: new Map<string, TableRow>(),
    deleted_custom_fields: new Map<string, TableRow>(),
    settings: new Map<string, TableRow>(),
    audit_log: new Map<string, TableRow>(),
  };

  pragma(_value: string): void {}

  exec(_sql: string): void {}

  close(): void {}

  prepare(sql: string) {
    return new FakeStatement(this, sql);
  }

  transaction<T extends (...args: any[]) => any>(fn: T): T {
    return ((...args: Parameters<T>) => fn(...args)) as T;
  }

  execute(mode: 'all' | 'get' | 'run', sql: string, args: any[]) {
    const normalized = normalizeSql(sql);
    const upper = normalized.toUpperCase();

    if (upper.startsWith('PRAGMA TABLE_INFO(')) {
      const tableName = normalized.match(/PRAGMA table_info\(([^)]+)\)/i)?.[1] as TableName;
      return TABLE_COLUMNS[tableName].map((name) => ({ name }));
    }

    if (upper === 'SELECT COUNT(*) AS COUNT FROM CATEGORIES') {
      return { count: this.tables.categories.size };
    }

    if (upper.startsWith('INSERT INTO CATEGORIES ')) {
      const [id, name, icon, color, sortOrder] = args;
      this.tables.categories.set(id, {
        id,
        name,
        icon,
        color,
        sort_order: sortOrder,
        created_at: new Date().toISOString(),
      });
      return { changes: 1 };
    }

    if (upper === 'SELECT * FROM RECORDS ORDER BY UPDATED_AT DESC') {
      return [...this.tables.records.values()]
        .map((row) => ({ ...row }))
        .sort((left, right) => compareIsoDesc(left.updated_at, right.updated_at));
    }

    if (upper === 'SELECT * FROM RECORDS WHERE ID = ?') {
      return cloneRow(this.tables.records.get(String(args[0])));
    }

    if (upper === 'SELECT * FROM CUSTOM_FIELDS ORDER BY SORT_ORDER, UPDATED_AT DESC') {
      return [...this.tables.custom_fields.values()]
        .map((row) => ({ ...row }))
        .sort((left, right) => left.sort_order - right.sort_order || compareIsoDesc(left.updated_at, right.updated_at));
    }

    if (upper === 'SELECT * FROM CUSTOM_FIELDS WHERE RECORD_ID = ? ORDER BY SORT_ORDER, CREATED_AT') {
      return [...this.tables.custom_fields.values()]
        .filter((row) => row.record_id === args[0])
        .map((row) => ({ ...row }))
        .sort((left, right) => left.sort_order - right.sort_order || String(left.created_at).localeCompare(String(right.created_at)));
    }

    if (upper.startsWith('UPDATE RECORDS SET ')) {
      const recordId = String(args[12]);
      const existing = this.tables.records.get(recordId);
      if (!existing) {
        return { changes: 0 };
      }

      this.tables.records.set(recordId, {
        ...existing,
        name: args[0],
        address: args[1],
        account: args[2],
        password_encrypted: args[3],
        key_encrypted: args[4],
        category_id: args[5],
        icon: args[6],
        color: args[7],
        favorite: args[8],
        updated_at: args[9],
        last_used_at: args[10],
        updated_by_device_id: args[11],
      });
      return { changes: 1 };
    }

    if (upper.startsWith('INSERT INTO RECORDS ')) {
      const [
        id,
        name,
        address,
        account,
        passwordEncrypted,
        keyEncrypted,
        categoryId,
        icon,
        color,
        favorite,
        createdAt,
        updatedAt,
        lastUsedAt,
        updatedByDeviceId,
      ] = args;
      this.tables.records.set(String(id), {
        id,
        name,
        address,
        account,
        password_encrypted: passwordEncrypted,
        key_encrypted: keyEncrypted,
        category_id: categoryId,
        icon,
        color,
        favorite,
        created_at: createdAt,
        updated_at: updatedAt,
        last_used_at: lastUsedAt,
        updated_by_device_id: updatedByDeviceId,
      });
      return { changes: 1 };
    }

    if (upper === 'DELETE FROM DELETED_RECORDS WHERE RECORD_ID = ?') {
      this.tables.deleted_records.delete(String(args[0]));
      return { changes: 1 };
    }

    if (upper.startsWith('UPDATE CUSTOM_FIELDS SET ')) {
      const fieldId = String(args[6]);
      const existing = this.tables.custom_fields.get(fieldId);
      if (!existing) {
        return { changes: 0 };
      }

      this.tables.custom_fields.set(fieldId, {
        ...existing,
        field_name: args[0],
        field_value_encrypted: args[1],
        field_type: args[2],
        sort_order: args[3],
        updated_at: args[4],
        updated_by_device_id: args[5],
      });
      return { changes: 1 };
    }

    if (upper.startsWith('INSERT INTO CUSTOM_FIELDS ')) {
      const [
        id,
        recordId,
        fieldName,
        fieldValueEncrypted,
        fieldType,
        sortOrder,
        createdAt,
        updatedAt,
        updatedByDeviceId,
      ] = args;
      this.tables.custom_fields.set(String(id), {
        id,
        record_id: recordId,
        field_name: fieldName,
        field_value_encrypted: fieldValueEncrypted,
        field_type: fieldType,
        sort_order: sortOrder,
        created_at: createdAt,
        updated_at: updatedAt,
        updated_by_device_id: updatedByDeviceId,
      });
      return { changes: 1 };
    }

    if (upper === 'DELETE FROM DELETED_CUSTOM_FIELDS WHERE FIELD_ID = ?') {
      this.tables.deleted_custom_fields.delete(String(args[0]));
      return { changes: 1 };
    }

    if (upper === 'SELECT * FROM CUSTOM_FIELDS WHERE ID = ?') {
      return cloneRow(this.tables.custom_fields.get(String(args[0])));
    }

    if (upper === 'DELETE FROM CUSTOM_FIELDS WHERE ID = ?') {
      this.tables.custom_fields.delete(String(args[0]));
      return { changes: 1 };
    }

    if (upper === 'DELETE FROM CUSTOM_FIELDS WHERE RECORD_ID = ?') {
      const recordId = String(args[0]);
      for (const [fieldId, row] of this.tables.custom_fields.entries()) {
        if (row.record_id === recordId) {
          this.tables.custom_fields.delete(fieldId);
        }
      }
      return { changes: 1 };
    }

    if (upper === 'DELETE FROM RECORDS WHERE ID = ?') {
      this.tables.records.delete(String(args[0]));
      return { changes: 1 };
    }

    if (upper.startsWith('SELECT DISTINCT RECORDS.* FROM RECORDS LEFT JOIN CUSTOM_FIELDS ON CUSTOM_FIELDS.RECORD_ID = RECORDS.ID WHERE (')) {
      const term = String(args[0]).replace(/%/g, '').toLowerCase();
      const categoryId = args[4] ? String(args[4]) : undefined;

      return [...this.tables.records.values()]
        .filter((record) => {
          if (categoryId && record.category_id !== categoryId) {
            return false;
          }

          const fieldNames = [...this.tables.custom_fields.values()]
            .filter((field) => field.record_id === record.id)
            .map((field) => String(field.field_name ?? ''));

          return [
            String(record.name ?? ''),
            String(record.address ?? ''),
            String(record.account ?? ''),
            ...fieldNames,
          ].some((value) => value.toLowerCase().includes(term));
        })
        .map((record) => ({ ...record }))
        .sort((left, right) => compareIsoDesc(left.updated_at, right.updated_at));
    }

    if (upper === 'SELECT ID, NAME, ICON, COLOR, SORT_ORDER FROM CATEGORIES ORDER BY SORT_ORDER') {
      return [...this.tables.categories.values()]
        .map((row) => ({ ...row }))
        .sort((left, right) => left.sort_order - right.sort_order);
    }

    if (upper === 'SELECT RECORD_ID, DELETED_AT, DEVICE_ID FROM DELETED_RECORDS ORDER BY DELETED_AT DESC') {
      return [...this.tables.deleted_records.values()]
        .map((row) => ({ ...row }))
        .sort((left, right) => compareIsoDesc(left.deleted_at, right.deleted_at));
    }

    if (upper === 'SELECT FIELD_ID, RECORD_ID, DELETED_AT, DEVICE_ID FROM DELETED_CUSTOM_FIELDS ORDER BY DELETED_AT DESC') {
      return [...this.tables.deleted_custom_fields.values()]
        .map((row) => ({ ...row }))
        .sort((left, right) => compareIsoDesc(left.deleted_at, right.deleted_at));
    }

    if (upper === 'DELETE FROM CUSTOM_FIELDS') {
      this.tables.custom_fields.clear();
      return { changes: 1 };
    }

    if (upper === 'DELETE FROM RECORDS') {
      this.tables.records.clear();
      return { changes: 1 };
    }

    if (upper === 'DELETE FROM DELETED_CUSTOM_FIELDS') {
      this.tables.deleted_custom_fields.clear();
      return { changes: 1 };
    }

    if (upper === 'DELETE FROM DELETED_RECORDS') {
      this.tables.deleted_records.clear();
      return { changes: 1 };
    }

    if (upper === 'SELECT (SELECT COUNT(*) FROM RECORDS) AS RECORDS_COUNT, (SELECT COUNT(*) FROM DELETED_RECORDS) AS DELETED_RECORDS_COUNT, (SELECT COUNT(*) FROM DELETED_CUSTOM_FIELDS) AS DELETED_CUSTOM_FIELDS_COUNT') {
      return {
        records_count: this.tables.records.size,
        deleted_records_count: this.tables.deleted_records.size,
        deleted_custom_fields_count: this.tables.deleted_custom_fields.size,
      };
    }

    if (upper === 'SELECT VALUE FROM SETTINGS WHERE KEY = ?') {
      return cloneRow(this.tables.settings.get(String(args[0])));
    }

    if (upper.startsWith('INSERT INTO SETTINGS (KEY, VALUE, UPDATED_AT) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(KEY) DO UPDATE SET VALUE = EXCLUDED.VALUE, UPDATED_AT = CURRENT_TIMESTAMP')) {
      const [key, value] = args;
      this.tables.settings.set(String(key), {
        key,
        value,
        updated_at: new Date().toISOString(),
      });
      return { changes: 1 };
    }

    if (upper.startsWith('INSERT INTO AUDIT_LOG (ID, ACTION, RECORD_ID, DETAILS, CREATED_AT) VALUES (?, ?, ?, ?, ?)')) {
      const [id, action, recordId, details, createdAt] = args;
      this.tables.audit_log.set(String(id), {
        id,
        action,
        record_id: recordId,
        details,
        created_at: createdAt,
      });
      return { changes: 1 };
    }

    if (upper === 'SELECT * FROM AUDIT_LOG ORDER BY CREATED_AT DESC LIMIT ?') {
      const limit = Number(args[0]);
      return [...this.tables.audit_log.values()]
        .map((row) => ({ ...row }))
        .sort((left, right) => compareIsoDesc(left.created_at, right.created_at))
        .slice(0, limit);
    }

    if (upper.startsWith('INSERT INTO DELETED_RECORDS (RECORD_ID, DELETED_AT, DEVICE_ID) VALUES (?, ?, ?) ON CONFLICT(RECORD_ID) DO UPDATE SET DELETED_AT = EXCLUDED.DELETED_AT, DEVICE_ID = EXCLUDED.DEVICE_ID')) {
      const [recordId, deletedAt, deviceId] = args;
      this.tables.deleted_records.set(String(recordId), {
        record_id: recordId,
        deleted_at: deletedAt,
        device_id: deviceId,
      });
      return { changes: 1 };
    }

    if (upper.startsWith('INSERT INTO DELETED_CUSTOM_FIELDS (FIELD_ID, RECORD_ID, DELETED_AT, DEVICE_ID) VALUES (?, ?, ?, ?) ON CONFLICT(FIELD_ID) DO UPDATE SET RECORD_ID = EXCLUDED.RECORD_ID, DELETED_AT = EXCLUDED.DELETED_AT, DEVICE_ID = EXCLUDED.DEVICE_ID')) {
      const [fieldId, recordId, deletedAt, deviceId] = args;
      this.tables.deleted_custom_fields.set(String(fieldId), {
        field_id: fieldId,
        record_id: recordId,
        deleted_at: deletedAt,
        device_id: deviceId,
      });
      return { changes: 1 };
    }

    throw new Error(`Unsupported SQL in fake better-sqlite3: ${normalized}`);
  }
}
