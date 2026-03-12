import { describe, expect, it } from 'vitest';
import { CryptoService } from './crypto';

describe('CryptoService', () => {
  it('encrypts and decrypts values with AES-GCM', () => {
    const crypto = new CryptoService();
    crypto.init('Passw0rd!');

    const encrypted = crypto.encrypt('super-secret');
    expect(encrypted).toContain('enc-v1:');
    expect(crypto.decrypt(encrypted)).toBe('super-secret');
  });

  it('verifies passwords and derives the same backup key for the same password', () => {
    const crypto = new CryptoService();
    const init = crypto.init('Passw0rd!');
    const exportKey = crypto.deriveBackupKey('aabbccddeeff00112233445566778899', 10_000).key.toString('hex');

    const verifier = new CryptoService();
    const result = verifier.verifyPassword('Passw0rd!', init.salt, init.verifier, init.iterations);

    expect(result.valid).toBe(true);
    expect(verifier.deriveBackupKey('aabbccddeeff00112233445566778899', 10_000).key.toString('hex')).toBe(exportKey);
  });
});
