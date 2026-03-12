import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

const CIPHER_VERSION = 'enc-v1';
const KEY_BYTES = 32;
const DERIVED_BYTES = 96;
const DEFAULT_ITERATIONS = 210_000;
const LEGACY_ITERATION_CANDIDATES = [100_000, DEFAULT_ITERATIONS];
const EXPORT_ITERATIONS = 260_000;
const AES_ALGORITHM = 'aes-256-gcm';
const VERIFIER_CONTEXT = Buffer.from('SecureVaultVerifierV2', 'utf8');

export interface VaultInitResult {
  salt: string;
  verifier: string;
  iterations: number;
}

export interface PasswordVerificationResult {
  valid: boolean;
}

export interface LegacyPasswordVerificationResult extends PasswordVerificationResult {
  matchedIterations?: number;
}

interface DerivedBundle {
  encryptionKey: Buffer;
  verifierKey: Buffer;
  exportSeed: Buffer;
}

function deriveKeys(password: string, saltHex: string, iterations: number): DerivedBundle {
  const derived = pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), iterations, DERIVED_BYTES, 'sha256');
  return {
    encryptionKey: derived.subarray(0, KEY_BYTES),
    verifierKey: derived.subarray(KEY_BYTES, KEY_BYTES * 2),
    exportSeed: derived.subarray(KEY_BYTES * 2),
  };
}

function buildVerifier(verifierKey: Buffer): string {
  const verifier = pbkdf2Sync(verifierKey, VERIFIER_CONTEXT, 1, KEY_BYTES, 'sha256');
  return verifier.toString('hex');
}

function buildLegacyKey(password: string, saltHex: string, iterations: number): Buffer {
  return pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), iterations, KEY_BYTES, 'sha256');
}

export class CryptoService {
  private encryptionKey: Buffer | null = null;
  private exportSeed: Buffer | null = null;
  private masterPassword: string | null = null;
  private saltHex: string | null = null;
  private iterations = DEFAULT_ITERATIONS;

  init(password: string, saltHex?: string, iterations: number = DEFAULT_ITERATIONS): VaultInitResult {
    const actualSalt = saltHex ?? randomBytes(16).toString('hex');
    const bundle = deriveKeys(password, actualSalt, iterations);

    this.encryptionKey = Buffer.from(bundle.encryptionKey);
    this.exportSeed = Buffer.from(bundle.exportSeed);
    this.masterPassword = password;
    this.saltHex = actualSalt;
    this.iterations = iterations;

    return {
      salt: actualSalt,
      verifier: buildVerifier(bundle.verifierKey),
      iterations,
    };
  }

  verifyPassword(password: string, saltHex: string, expectedVerifier: string, iterations: number = DEFAULT_ITERATIONS): PasswordVerificationResult {
    const bundle = deriveKeys(password, saltHex, iterations);
    const actualVerifier = Buffer.from(buildVerifier(bundle.verifierKey), 'hex');
    const expected = Buffer.from(expectedVerifier, 'hex');

    const valid = expected.length === actualVerifier.length && timingSafeEqual(expected, actualVerifier);
    if (valid) {
      this.encryptionKey = Buffer.from(bundle.encryptionKey);
      this.exportSeed = Buffer.from(bundle.exportSeed);
      this.masterPassword = password;
      this.saltHex = saltHex;
      this.iterations = iterations;
    }

    return { valid };
  }

  verifyLegacyPassword(password: string, saltHex: string, expectedLegacyKey: string): LegacyPasswordVerificationResult {
    const expected = Buffer.from(expectedLegacyKey, 'hex');

    for (const iterations of LEGACY_ITERATION_CANDIDATES) {
      const actual = buildLegacyKey(password, saltHex, iterations);
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
        return { valid: true, matchedIterations: iterations };
      }
    }

    return { valid: false };
  }

  clear(): void {
    this.encryptionKey?.fill(0);
    this.exportSeed?.fill(0);
    this.encryptionKey = null;
    this.exportSeed = null;
    this.masterPassword = null;
    this.saltHex = null;
  }

  isInitialized(): boolean {
    return this.encryptionKey !== null;
  }

  getKdfConfig(): { salt: string | null; iterations: number } {
    return {
      salt: this.saltHex,
      iterations: this.iterations,
    };
  }

  encrypt(plaintext: string): string {
    if (!this.encryptionKey) {
      throw new Error('Crypto service not initialized');
    }
    if (!plaintext) {
      return '';
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv(AES_ALGORITHM, this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      CIPHER_VERSION,
      iv.toString('hex'),
      authTag.toString('hex'),
      ciphertext.toString('hex'),
    ].join(':');
  }

  decrypt(payload: string): string {
    if (!payload) {
      return '';
    }
    if (!this.encryptionKey) {
      throw new Error('Crypto service not initialized');
    }
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
      return payload;
    }

    const [, ivHex, authTagHex, cipherHex] = parts;
    const decipher = createDecipheriv(
      AES_ALGORITHM,
      this.encryptionKey,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  isEncrypted(payload?: string | null): boolean {
    return typeof payload === 'string' && payload.startsWith(`${CIPHER_VERSION}:`);
  }

  createVaultId(): string {
    return randomUUID();
  }

  createDeviceId(): string {
    return randomUUID();
  }

  deriveBackupKey(saltHex?: string, iterations: number = EXPORT_ITERATIONS): { key: Buffer; salt: string; iterations: number } {
    if (!this.masterPassword) {
      throw new Error('Vault is locked');
    }
    const actualSalt = saltHex ?? randomBytes(16).toString('hex');
    const key = pbkdf2Sync(this.masterPassword, Buffer.from(actualSalt, 'hex'), iterations, KEY_BYTES, 'sha256');
    return { key, salt: actualSalt, iterations };
  }

  encryptWithKey(plaintext: string, key: Buffer): string {
    if (!plaintext) {
      return '';
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv(AES_ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return JSON.stringify({
      version: 1,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      ciphertext: ciphertext.toString('base64'),
    });
  }

  decryptWithKey(payload: string, key: Buffer): string {
    const parsed = JSON.parse(payload) as {
      version: number;
      iv: string;
      authTag: string;
      ciphertext: string;
    };

    if (parsed.version !== 1) {
      throw new Error(`Unsupported encrypted payload version: ${parsed.version}`);
    }

    const decipher = createDecipheriv(AES_ALGORITHM, key, Buffer.from(parsed.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(parsed.authTag, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(parsed.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }

  getExportSeed(): Buffer {
    if (!this.exportSeed) {
      throw new Error('Vault is locked');
    }
    return Buffer.from(this.exportSeed);
  }

  generatePassword(length: number = 16): string {
    const lowerCase = 'abcdefghijkmnopqrstuvwxyz';
    const upperCase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const numbers = '23456789';
    const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const allChars = `${lowerCase}${upperCase}${numbers}${special}`;

    const chars = [
      lowerCase[Math.floor(Math.random() * lowerCase.length)],
      upperCase[Math.floor(Math.random() * upperCase.length)],
      numbers[Math.floor(Math.random() * numbers.length)],
      special[Math.floor(Math.random() * special.length)],
    ];

    while (chars.length < length) {
      chars.push(allChars[Math.floor(Math.random() * allChars.length)]);
    }

    return chars
      .sort(() => Math.random() - 0.5)
      .join('');
  }

  calculateStrength(password: string): { score: number; label: string; color: string } {
    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^a-zA-Z0-9]/.test(password)) score += 1;

    if (score <= 3) {
      return { score, label: '弱', color: '#ff3b30' };
    }
    if (score <= 5) {
      return { score, label: '中等', color: '#ff9500' };
    }
    return { score, label: '强', color: '#34c759' };
  }
}
