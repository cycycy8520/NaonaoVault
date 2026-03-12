import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pbkdf2Sync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import FakeBetterSqlite3 from '../../test-support/fake-better-sqlite3';

vi.mock('better-sqlite3', () => ({
  default: FakeBetterSqlite3,
}));

import { CryptoService } from './crypto';
import { DatabaseService } from './database';
import { VaultService } from './vault-service';

function createVaultHarness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'secure-vault-vault-'));
  const db = new DatabaseService(path.join(dir, 'vault.db'));
  const crypto = new CryptoService();
  const vault = new VaultService(db, crypto);

  return {
    dir,
    db,
    crypto,
    vault,
    cleanup() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('VaultService', () => {
  it('stores encrypted rows while returning decrypted records to callers', () => {
    const harness = createVaultHarness();

    try {
      expect(harness.vault.initVault('Passw0rd!')).toEqual({ success: true });

      const record = harness.vault.createRecord({
        name: 'OpenAI',
        categoryId: 'ai-tools',
        address: 'https://platform.openai.com',
        account: 'demo@example.com',
        password: 'SuperSecret!123',
        key: 'sk-demo-key',
        customFields: [
          {
            fieldName: 'workspace',
            fieldValue: 'alpha',
            fieldType: 'text',
            sortOrder: 0,
          },
        ],
      });

      const rawRow = harness.db.getRecordRowById(record.id);
      const rawField = harness.db.getCustomFieldRowsByRecordId(record.id)[0];
      const logs = harness.db.getRecentAuditLogs(5);

      expect(rawRow?.password_encrypted).toMatch(/^enc-v1:/);
      expect(rawRow?.password_encrypted).not.toContain('SuperSecret!123');
      expect(rawRow?.key_encrypted).toMatch(/^enc-v1:/);
      expect(rawField.field_value_encrypted).toMatch(/^enc-v1:/);
      expect(record.password).toBe('SuperSecret!123');
      expect(record.key).toBe('sk-demo-key');
      expect(record.customFields[0].fieldValue).toBe('alpha');
      expect(logs[0].action).toBe('CREATE');
      expect(logs[0].record_id).toBe(record.id);
    } finally {
      harness.cleanup();
    }
  });

  it('migrates legacy plaintext secrets after a successful unlock', () => {
    const harness = createVaultHarness();

    try {
      harness.vault.initVault('Passw0rd!');
      harness.db.setSetting('vaultDataVersion', '1');
      harness.db.saveRecordGraph(
        {
          id: 'legacy-record',
          name: 'Legacy',
          category_id: 'work',
          account: 'legacy@example.com',
          password_encrypted: 'plain-password',
          key_encrypted: 'plain-key',
          favorite: 0,
          created_at: '2026-03-11T00:00:00.000Z',
          updated_at: '2026-03-11T00:00:00.000Z',
          updated_by_device_id: 'legacy-device',
        },
        [
          {
            id: 'legacy-field',
            record_id: 'legacy-record',
            field_name: 'workspace',
            field_value_encrypted: 'plain-field',
            field_type: 'text',
            sort_order: 0,
            created_at: '2026-03-11T00:00:00.000Z',
            updated_at: '2026-03-11T00:00:00.000Z',
            updated_by_device_id: 'legacy-device',
          },
        ],
      );
      harness.vault.lock();

      expect(harness.vault.verifyPassword('Passw0rd!')).toEqual({ valid: true });

      const migratedRow = harness.db.getRecordRowById('legacy-record');
      const migratedField = harness.db.getCustomFieldRowsByRecordId('legacy-record')[0];
      const record = harness.vault.getRecordById('legacy-record');

      expect(migratedRow?.password_encrypted).toMatch(/^enc-v1:/);
      expect(migratedRow?.password_encrypted).not.toBe('plain-password');
      expect(migratedRow?.key_encrypted).toMatch(/^enc-v1:/);
      expect(migratedField.field_value_encrypted).toMatch(/^enc-v1:/);
      expect(record?.password).toBe('plain-password');
      expect(record?.key).toBe('plain-key');
      expect(record?.customFields[0].fieldValue).toBe('plain-field');
      expect(harness.db.getSetting('vaultDataVersion')).toBe('2');
    } finally {
      harness.cleanup();
    }
  });

  it('unlocks legacy vaults that only store vaultKey metadata and upgrades them in place', () => {
    const harness = createVaultHarness();

    try {
      const legacyPassword = 'LegacyPass!2024';
      const legacySalt = 'fdf3cc88d4e6d611a149bbb700fc2e35';
      const legacyKey = pbkdf2Sync(
        legacyPassword,
        Buffer.from(legacySalt, 'hex'),
        100_000,
        32,
        'sha256',
      ).toString('hex');

      harness.db.setSetting('vaultInitialized', 'true');
      harness.db.setSetting('vaultSalt', legacySalt);
      harness.db.setSetting('vaultKey', legacyKey);
      harness.db.setSetting('vaultDataVersion', '1');
      harness.db.setSetting('vaultId', 'legacy-vault-id');
      harness.db.setSetting('deviceId', 'legacy-device-id');
      harness.db.saveRecordGraph(
        {
          id: 'legacy-record',
          name: 'Legacy import',
          category_id: 'work',
          account: 'legacy@example.com',
          password_encrypted: 'plain-password',
          key_encrypted: 'plain-key',
          favorite: 0,
          created_at: '2026-03-11T00:00:00.000Z',
          updated_at: '2026-03-11T00:00:00.000Z',
          updated_by_device_id: 'legacy-device-id',
        },
        [],
      );

      expect(harness.vault.verifyPassword(legacyPassword)).toEqual({ valid: true });

      const upgradedVerifier = harness.db.getSetting('vaultVerifier');
      const upgradedIterations = harness.db.getSetting('vaultIterations');
      const upgradedRow = harness.db.getRecordRowById('legacy-record');
      const record = harness.vault.getRecordById('legacy-record');

      expect(upgradedVerifier).toBeTruthy();
      expect(upgradedIterations).toBe('210000');
      expect(harness.db.getSetting('vaultKey')).toBe(legacyKey);
      expect(harness.db.getSetting('vaultDataVersion')).toBe('2');
      expect(upgradedRow?.password_encrypted).toMatch(/^enc-v1:/);
      expect(upgradedRow?.key_encrypted).toMatch(/^enc-v1:/);
      expect(record?.password).toBe('plain-password');
      expect(record?.key).toBe('plain-key');
    } finally {
      harness.cleanup();
    }
  });

  it('encrypts AI settings at rest and decrypts them when loaded', () => {
    const harness = createVaultHarness();

    try {
      harness.vault.initVault('Passw0rd!');
      harness.vault.setAISettings({
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-test',
        apiKey: 'sk-secret-value',
        searchMode: 'extended',
      });

      const stored = harness.db.getSetting('aiConfig');
      const loaded = harness.vault.getAISettings();

      expect(stored).toContain('apiKeyEncrypted');
      expect(stored).not.toContain('sk-secret-value');
      expect(loaded).toEqual({
        baseUrl: 'https://api.example.com/v1',
        model: 'gpt-test',
        apiKey: 'sk-secret-value',
        searchMode: 'extended',
      });
    } finally {
      harness.cleanup();
    }
  });
});
