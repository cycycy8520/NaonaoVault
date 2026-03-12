import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import FakeBetterSqlite3 from '../../test-support/fake-better-sqlite3';

vi.mock('better-sqlite3', () => ({
  default: FakeBetterSqlite3,
}));

import { DatabaseService } from './database';

function createDatabaseHarness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'secure-vault-db-'));
  const db = new DatabaseService(path.join(dir, 'vault.db'));

  return {
    dir,
    db,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('DatabaseService', () => {
  it('upserts record graphs and tracks removed custom fields as tombstones', () => {
    const harness = createDatabaseHarness();

    try {
      harness.db.saveRecordGraph(
        {
          id: 'record-1',
          name: 'OpenAI',
          account: 'first@example.com',
          password_encrypted: 'enc-v1:first-password',
          category_id: 'work',
          favorite: 0,
          created_at: '2026-03-11T00:00:00.000Z',
          updated_at: '2026-03-11T00:00:00.000Z',
          updated_by_device_id: 'device-a',
        },
        [
          {
            id: 'field-1',
            record_id: 'record-1',
            field_name: 'project',
            field_value_encrypted: 'enc-v1:alpha',
            field_type: 'text',
            sort_order: 0,
            created_at: '2026-03-11T00:00:00.000Z',
            updated_at: '2026-03-11T00:00:00.000Z',
            updated_by_device_id: 'device-a',
          },
          {
            id: 'field-2',
            record_id: 'record-1',
            field_name: 'workspace',
            field_value_encrypted: 'enc-v1:beta',
            field_type: 'text',
            sort_order: 1,
            created_at: '2026-03-11T00:00:00.000Z',
            updated_at: '2026-03-11T00:00:00.000Z',
            updated_by_device_id: 'device-a',
          },
        ],
      );

      harness.db.saveRecordGraph(
        {
          id: 'record-1',
          name: 'OpenAI Team',
          account: 'second@example.com',
          password_encrypted: 'enc-v1:second-password',
          category_id: 'work',
          favorite: 1,
          created_at: '2026-03-11T00:00:00.000Z',
          updated_at: '2026-03-11T01:00:00.000Z',
          updated_by_device_id: 'device-b',
        },
        [
          {
            id: 'field-1',
            record_id: 'record-1',
            field_name: 'project',
            field_value_encrypted: 'enc-v1:alpha-updated',
            field_type: 'text',
            sort_order: 0,
            created_at: '2026-03-11T00:00:00.000Z',
            updated_at: '2026-03-11T01:00:00.000Z',
            updated_by_device_id: 'device-b',
          },
        ],
      );

      const record = harness.db.getRecordRowById('record-1');
      const fields = harness.db.getCustomFieldRowsByRecordId('record-1');
      const deletedFields = harness.db.getDeletedCustomFields();

      expect(record?.name).toBe('OpenAI Team');
      expect(record?.account).toBe('second@example.com');
      expect(record?.updated_by_device_id).toBe('device-b');
      expect(fields).toHaveLength(1);
      expect(fields[0].id).toBe('field-1');
      expect(fields[0].field_value_encrypted).toBe('enc-v1:alpha-updated');
      expect(deletedFields).toEqual([
        {
          fieldId: 'field-2',
          recordId: 'record-1',
          deletedAt: '2026-03-11T01:00:00.000Z',
          deviceId: 'device-b',
        },
      ]);
    } finally {
      harness.cleanup();
    }
  });

  it('deletes records and writes record and field tombstones', () => {
    const harness = createDatabaseHarness();

    try {
      harness.db.saveRecordGraph(
        {
          id: 'record-1',
          name: 'GitHub',
          category_id: 'work',
          favorite: 0,
          created_at: '2026-03-11T00:00:00.000Z',
          updated_at: '2026-03-11T00:00:00.000Z',
          updated_by_device_id: 'device-a',
        },
        [
          {
            id: 'field-1',
            record_id: 'record-1',
            field_name: 'org',
            field_value_encrypted: 'enc-v1:org-1',
            field_type: 'text',
            sort_order: 0,
            created_at: '2026-03-11T00:00:00.000Z',
            updated_at: '2026-03-11T00:00:00.000Z',
            updated_by_device_id: 'device-a',
          },
          {
            id: 'field-2',
            record_id: 'record-1',
            field_name: 'repo',
            field_value_encrypted: 'enc-v1:repo-1',
            field_type: 'text',
            sort_order: 1,
            created_at: '2026-03-11T00:00:00.000Z',
            updated_at: '2026-03-11T00:00:00.000Z',
            updated_by_device_id: 'device-a',
          },
        ],
      );

      expect(harness.db.deleteRecord('record-1', 'device-z')).toBe(true);

      expect(harness.db.getRecordRowById('record-1')).toBeUndefined();
      expect(harness.db.getCustomFieldRowsByRecordId('record-1')).toEqual([]);
      expect(harness.db.getDeletedRecords()).toEqual([
        expect.objectContaining({
          recordId: 'record-1',
          deviceId: 'device-z',
        }),
      ]);
      expect(harness.db.getDeletedCustomFields()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fieldId: 'field-1', recordId: 'record-1', deviceId: 'device-z' }),
          expect.objectContaining({ fieldId: 'field-2', recordId: 'record-1', deviceId: 'device-z' }),
        ]),
      );
      expect(harness.db.isVaultEmpty()).toBe(false);
    } finally {
      harness.cleanup();
    }
  });

  it('searches across record fields and custom field names with category filtering', () => {
    const harness = createDatabaseHarness();

    try {
      harness.db.saveRecordGraph(
        {
          id: 'record-1',
          name: 'OpenAI',
          address: 'platform.openai.com',
          account: 'demo@example.com',
          category_id: 'ai-tools',
          favorite: 0,
          created_at: '2026-03-11T00:00:00.000Z',
          updated_at: '2026-03-11T00:00:00.000Z',
          updated_by_device_id: 'device-a',
        },
        [
          {
            id: 'field-1',
            record_id: 'record-1',
            field_name: 'workspace',
            field_value_encrypted: 'enc-v1:alpha',
            field_type: 'text',
            sort_order: 0,
            created_at: '2026-03-11T00:00:00.000Z',
            updated_at: '2026-03-11T00:00:00.000Z',
            updated_by_device_id: 'device-a',
          },
        ],
      );

      harness.db.saveRecordGraph(
        {
          id: 'record-2',
          name: 'GitHub',
          address: 'github.com',
          account: 'code@example.com',
          category_id: 'work',
          favorite: 0,
          created_at: '2026-03-11T00:00:00.000Z',
          updated_at: '2026-03-11T00:00:00.000Z',
          updated_by_device_id: 'device-a',
        },
        [],
      );

      expect(harness.db.searchRecordRows('workspace').map((row) => row.id)).toEqual(['record-1']);
      expect(harness.db.searchRecordRows('github').map((row) => row.id)).toEqual(['record-2']);
      expect(harness.db.searchRecordRows('workspace', 'work')).toEqual([]);
      expect(harness.db.searchRecordRows('demo@example.com', 'ai-tools').map((row) => row.id)).toEqual(['record-1']);
    } finally {
      harness.cleanup();
    }
  });
});
