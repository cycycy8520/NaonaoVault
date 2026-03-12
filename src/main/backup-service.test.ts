import { describe, expect, it } from 'vitest';
import { applyImportPlan, buildImportPreview, mergeSnapshots } from './backup-service';
import { VaultSnapshot } from './contracts';

const baseCategories = [
  { id: 'work', name: '工作', icon: '💼', color: '#0EA5E9', sortOrder: 1 },
];

function createSnapshot(partial: Partial<VaultSnapshot>): VaultSnapshot {
  return {
    version: 1,
    vaultId: 'vault-1',
    exportedAt: '2026-03-11T00:00:00.000Z',
    contentHash: '',
    categories: baseCategories,
    records: [],
    deletedRecords: [],
    deletedCustomFields: [],
    ...partial,
  };
}

describe('mergeSnapshots', () => {
  it('uses the newer record update when both sides changed the same record', () => {
    const local = createSnapshot({
      records: [
        {
          id: 'record-1',
          name: 'OpenAI',
          categoryId: 'work',
          address: 'https://platform.openai.com',
          account: 'local@example.com',
          password: 'local-secret',
          key: '',
          icon: '',
          color: '',
          favorite: false,
          createdAt: '2026-03-11T00:00:00.000Z',
          updatedAt: '2026-03-11T08:00:00.000Z',
          lastUsedAt: '',
          updatedByDeviceId: 'device-a',
          customFields: [],
        },
      ],
    });

    const remote = createSnapshot({
      records: [
        {
          id: 'record-1',
          name: 'OpenAI Team',
          categoryId: 'work',
          address: 'https://platform.openai.com',
          account: 'remote@example.com',
          password: 'remote-secret',
          key: '',
          icon: '',
          color: '',
          favorite: false,
          createdAt: '2026-03-11T00:00:00.000Z',
          updatedAt: '2026-03-11T09:00:00.000Z',
          lastUsedAt: '',
          updatedByDeviceId: 'device-b',
          customFields: [],
        },
      ],
    });

    const merged = mergeSnapshots(local, remote);
    expect(merged.records).toHaveLength(1);
    expect(merged.records[0].name).toBe('OpenAI Team');
    expect(merged.records[0].account).toBe('remote@example.com');
  });

  it('keeps a tombstone when delete is newer than update', () => {
    const local = createSnapshot({
      deletedRecords: [
        {
          recordId: 'record-1',
          deletedAt: '2026-03-11T10:00:00.000Z',
          deviceId: 'device-a',
        },
      ],
    });

    const remote = createSnapshot({
      records: [
        {
          id: 'record-1',
          name: 'OpenAI',
          categoryId: 'work',
          address: '',
          account: 'remote@example.com',
          password: 'remote-secret',
          key: '',
          icon: '',
          color: '',
          favorite: false,
          createdAt: '2026-03-11T00:00:00.000Z',
          updatedAt: '2026-03-11T09:00:00.000Z',
          lastUsedAt: '',
          updatedByDeviceId: 'device-b',
          customFields: [],
        },
      ],
    });

    const merged = mergeSnapshots(local, remote);
    expect(merged.records).toHaveLength(0);
    expect(merged.deletedRecords).toEqual([
      {
        recordId: 'record-1',
        deletedAt: '2026-03-11T10:00:00.000Z',
        deviceId: 'device-a',
      },
    ]);
  });
});

describe('import preview and plan', () => {
  it('detects suspected duplicates by name and account', () => {
    const local = createSnapshot({
      vaultId: 'vault-local',
      records: [
        {
          id: 'local-1',
          name: 'Gitee',
          categoryId: 'work',
          address: '',
          account: 'naonao8520',
          password: 'local-secret',
          key: '',
          icon: '',
          color: '',
          favorite: false,
          createdAt: '2026-03-11T00:00:00.000Z',
          updatedAt: '2026-03-11T08:00:00.000Z',
          lastUsedAt: '',
          updatedByDeviceId: 'device-a',
          customFields: [],
        },
      ],
    });

    const remote = createSnapshot({
      vaultId: 'vault-remote',
      records: [
        {
          id: 'remote-1',
          name: 'Gitee',
          categoryId: 'work',
          address: 'https://gitee.com',
          account: 'naonao8520',
          password: 'remote-secret',
          key: '',
          icon: '',
          color: '',
          favorite: false,
          createdAt: '2026-03-11T00:00:00.000Z',
          updatedAt: '2026-03-11T09:00:00.000Z',
          lastUsedAt: '',
          updatedByDeviceId: 'device-b',
          customFields: [],
        },
      ],
    });

    const preview = buildImportPreview(local, remote, 'sample.svlt');

    expect(preview.sameVault).toBe(false);
    expect(preview.duplicateCount).toBe(1);
    expect(preview.items[0].status).toBe('duplicate');
    expect(preview.items[0].duplicateCandidates[0].localRecordId).toBe('local-1');
    expect(preview.items[0].duplicateCandidates[0].matchedBy).toEqual(expect.arrayContaining(['账号', '名称']));
  });

  it('merges missing fields into the chosen local record on cross-vault import', () => {
    const local = createSnapshot({
      vaultId: 'vault-local',
      records: [
        {
          id: 'local-1',
          name: 'Gitee',
          categoryId: 'work',
          address: '',
          account: 'naonao8520',
          password: 'local-secret',
          key: '',
          icon: '',
          color: '',
          favorite: false,
          createdAt: '2026-03-11T00:00:00.000Z',
          updatedAt: '2026-03-11T08:00:00.000Z',
          lastUsedAt: '',
          updatedByDeviceId: 'device-a',
          customFields: [],
        },
      ],
    });

    const remote = createSnapshot({
      vaultId: 'vault-remote',
      records: [
        {
          id: 'remote-1',
          name: 'Gitee',
          categoryId: 'work',
          address: 'https://gitee.com',
          account: 'naonao8520',
          password: 'remote-secret',
          key: '',
          icon: '',
          color: '',
          favorite: true,
          createdAt: '2026-03-11T00:00:00.000Z',
          updatedAt: '2026-03-11T09:00:00.000Z',
          lastUsedAt: '',
          updatedByDeviceId: 'device-b',
          customFields: [
            {
              id: 'remote-field-1',
              recordId: 'remote-1',
              fieldName: '备注',
              fieldValue: '来自导入',
              fieldType: 'text',
              sortOrder: 0,
              createdAt: '2026-03-11T00:00:00.000Z',
              updatedAt: '2026-03-11T09:00:00.000Z',
              updatedByDeviceId: 'device-b',
            },
          ],
        },
      ],
    });

    const preview = buildImportPreview(local, remote, 'sample.svlt');
    const applied = applyImportPlan(
      local,
      remote,
      preview,
      [{
        importRecordId: 'remote-1',
        strategy: 'merge-fields',
        targetLocalRecordId: 'local-1',
      }],
      'device-local',
    );

    expect(applied.snapshot.records).toHaveLength(1);
    expect(applied.mergedCount).toBe(1);
    expect(applied.importedCount).toBe(0);
    expect(applied.snapshot.records[0].id).toBe('local-1');
    expect(applied.snapshot.records[0].address).toBe('https://gitee.com');
    expect(applied.snapshot.records[0].password).toBe('local-secret');
    expect(applied.snapshot.records[0].favorite).toBe(true);
    expect(applied.snapshot.records[0].customFields[0].fieldName).toBe('备注');
    expect(applied.snapshot.records[0].customFields[0].fieldValue).toBe('来自导入');
  });
});
