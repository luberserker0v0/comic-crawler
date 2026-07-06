export interface EncryptedData {
  encrypted: string;
  iv: string;
  algorithm: 'aes-256-gcm';
}

export interface Credential {
  username?: string;
  password?: string;
  cookie?: string;
  [key: string]: string | undefined;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}
