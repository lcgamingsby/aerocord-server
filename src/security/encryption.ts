import crypto from 'crypto';

// Master encryption key derived using PBKDF2 (Bank & Military Grade AES-256-GCM)
const MASTER_SECRET = process.env.AEROCORD_ENCRYPTION_KEY || 'aerocord-military-grade-aes-256-gcm-master-key-2026';
const SALT = process.env.AEROCORD_PEPPER || 'aerocord-cryptographic-salt-pepper-v4';
const KEY = crypto.pbkdf2Sync(MASTER_SECRET, SALT, 100000, 32, 'sha512');
const HMAC_KEY = crypto.pbkdf2Sync(MASTER_SECRET, SALT + '_hmac', 100000, 64, 'sha512');

export interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

/**
 * Layer 1: AES-256-GCM Authenticated Encryption
 */
export function encryptAES256GCM(plainText: string): EncryptedPayload {
  const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    iv: iv.toString('hex'),
    tag,
    data: encrypted
  };
}

/**
 * Layer 1: AES-256-GCM Authenticated Decryption
 */
export function decryptAES256GCM(payload: EncryptedPayload): string | null {
  try {
    const iv = Buffer.from(payload.iv, 'hex');
    const tag = Buffer.from(payload.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[Security Engine] Decryption failed or data tampered:', err);
    return null;
  }
}

/**
 * Layer 2: HMAC-SHA512 Cryptographic Tamper-Proof Signature
 */
export function generateIntegritySeal(data: any): string {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  return crypto.createHmac('sha512', HMAC_KEY).update(serialized).digest('hex');
}

export function verifyIntegritySeal(data: any, expectedSeal: string): boolean {
  const actualSeal = generateIntegritySeal(data);
  try {
    return crypto.timingSafeEqual(Buffer.from(actualSeal, 'hex'), Buffer.from(expectedSeal, 'hex'));
  } catch {
    return false;
  }
}

/**
 * TOTP Engine (RFC 6238 - Google Authenticator standard)
 */
// Base32 alphabet standard
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(length: number = 20): string {
  const randomBytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < randomBytes.length; i++) {
    result += BASE32_ALPHABET[randomBytes[i] % 32];
  }
  return result;
}

function base32ToBuffer(base32: string): Buffer {
  const clean = base32.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = '';
  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_ALPHABET.indexOf(clean[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Generate 6-digit TOTP code for a specific time step (30s window)
 */
export function generateTOTPCode(secretBase32: string, timeOffsetSteps: number = 0): string {
  const key = base32ToBuffer(secretBase32);
  const epoch = Math.floor(Date.now() / 1000);
  const timeStep = Math.floor(epoch / 30) + timeOffsetSteps;

  const buffer = Buffer.alloc(8);
  buffer.writeBigInt64BE(BigInt(timeStep));

  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) |
               ((hmac[offset + 1] & 0xff) << 16) |
               ((hmac[offset + 2] & 0xff) << 8) |
               (hmac[offset + 3] & 0xff);

  const otp = (code % 1000000).toString().padStart(6, '0');
  return otp;
}

/**
 * Verify TOTP code with time drift window tolerance (±1 step = ±30s)
 */
export function verifyTOTPCode(secretBase32: string, code: string): boolean {
  if (!secretBase32 || !code) return false;
  const cleanCode = code.trim();

  for (let offset = -1; offset <= 1; offset++) {
    const validCode = generateTOTPCode(secretBase32, offset);
    if (validCode === cleanCode) {
      return true;
    }
  }
  return false;
}

/**
 * Security Key File (.aerocord-key) Generator & Validator
 */
export interface SecurityKeyFileContent {
  app: string;
  version: string;
  userId: string;
  username: string;
  keyId: string;
  token: string;
  issuedAt: string;
  signature: string;
}

export function generateSecurityKeyFile(userId: string, username: string): { fileContent: string; keyId: string; rawToken: string } {
  const keyId = `key_${crypto.randomBytes(8).toString('hex')}`;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const issuedAt = new Date().toISOString();

  const dataToSign = `${userId}:${username}:${keyId}:${rawToken}:${issuedAt}`;
  const signature = crypto.createHmac('sha256', HMAC_KEY).update(dataToSign).digest('hex');

  const filePayload: SecurityKeyFileContent = {
    app: 'AeroCord Security Key',
    version: '4.0',
    userId,
    username,
    keyId,
    token: rawToken,
    issuedAt,
    signature
  };

  return {
    fileContent: JSON.stringify(filePayload, null, 2),
    keyId,
    rawToken
  };
}

export function verifySecurityKeyFile(contentStr: string, expectedUserId?: string): { valid: boolean; keyId?: string; userId?: string; error?: string } {
  try {
    const parsed: SecurityKeyFileContent = typeof contentStr === 'string' ? JSON.parse(contentStr) : contentStr;
    if (!parsed || parsed.app !== 'AeroCord Security Key' || !parsed.token || !parsed.signature) {
      return { valid: false, error: 'Format file kunci tidak valid atau rusak.' };
    }

    if (expectedUserId && parsed.userId !== expectedUserId) {
      return { valid: false, error: 'File kunci ini tidak cocok dengan akun yang sedang login.' };
    }

    const dataToSign = `${parsed.userId}:${parsed.username}:${parsed.keyId}:${parsed.token}:${parsed.issuedAt}`;
    const expectedSig = crypto.createHmac('sha256', HMAC_KEY).update(dataToSign).digest('hex');

    const isValid = crypto.timingSafeEqual(Buffer.from(parsed.signature, 'hex'), Buffer.from(expectedSig, 'hex'));
    if (!isValid) {
      return { valid: false, error: 'Tanda tangan digital file kunci tidak sah / telah dimodifikasi.' };
    }

    return { valid: true, keyId: parsed.keyId, userId: parsed.userId };
  } catch (err: any) {
    return { valid: false, error: 'Gagal memproses file kunci: ' + err.message };
  }
}
