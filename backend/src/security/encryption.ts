import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { EncryptedData } from './types';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export class EncryptionService {
  private key: Buffer;

  constructor(secret: string) {
    this.key = this.deriveKey(secret);
  }

  encrypt(data: string): EncryptedData {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH });

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      algorithm: ALGORITHM,
      authTag: authTag.toString('hex'),
    } as EncryptedData & { authTag: string };
  }

  decrypt(encryptedData: EncryptedData & { authTag: string }): string {
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');

    const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private deriveKey(secret: string): Buffer {
    const hash = require('node:crypto').createHash('sha256');
    hash.update(secret);
    return hash.digest();
  }
}
