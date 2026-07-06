import type { Credential } from './types';
import { EncryptionService } from './encryption';

export class CredentialManager {
  private encryption: EncryptionService;
  private credentials = new Map<string, Credential>();

  constructor(secret: string) {
    this.encryption = new EncryptionService(secret);
  }

  async store(adapterId: string, credential: Credential): Promise<void> {
    const serialized = JSON.stringify(credential);
    const encrypted = this.encryption.encrypt(serialized);
    this.credentials.set(adapterId, { _encrypted: JSON.stringify(encrypted) } as unknown as Credential);
  }

  async retrieve(adapterId: string): Promise<Credential | undefined> {
    const stored = this.credentials.get(adapterId);
    if (!stored) return undefined;

    const encrypted = JSON.parse((stored as any)._encrypted);
    const decrypted = this.encryption.decrypt(encrypted);
    return JSON.parse(decrypted) as Credential;
  }

  async remove(adapterId: string): Promise<void> {
    this.credentials.delete(adapterId);
  }

  clear(): void {
    this.credentials.clear();
  }
}
