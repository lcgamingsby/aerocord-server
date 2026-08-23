import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database';
import { generateToken, AuthenticatedRequest } from '../middleware/auth';
import { User, FriendRelation } from '../types';
import { 
  generateBase32Secret, 
  verifyTOTPCode, 
  generateSecurityKeyFile, 
  verifySecurityKeyFile, 
  encryptAES256GCM, 
  decryptAES256GCM,
  EncryptedPayload 
} from '../security/encryption';

// In-memory store for Two-Factor Authentication login challenges: challengeId -> { userId, code, expiresAt }
const twoFactorChallenges = new Map<string, { userId: string; code?: string; expiresAt: number }>();
// Pending setup secrets
const pending2FASetups = new Map<string, { secret: string; keyId?: string; rawToken?: string; type: 'google' | 'file'; expiresAt: number }>();

function maskEmail(email: string): string {
  const parts = email.split('@');
  if (parts.length < 2) return email;
  const name = parts[0];
  const maskedName = name.length > 2 ? `${name.substring(0, 2)}***${name.substring(name.length - 1)}` : `${name}***`;
  return `${maskedName}@${parts[1]}`;
}

// Verification codes map: email -> { code, expiresAt }
const verificationCodes = new Map<string, { code: string; expiresAt: number }>();

export const checkAvailability = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : undefined;
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : undefined;

  let usernameAvailable = true;
  let emailAvailable = true;

  if (username) {
    const existing = await db.getUserByUsername(username);
    if (existing) usernameAvailable = false;
  }

  if (email) {
    const existing = await db.getUserByEmail(email);
    if (existing) emailAvailable = false;
  }

  res.json({ usernameAvailable, emailAvailable });
};

export const register = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { username, email, password, avatar } = req.body;

  if (!username || !email || !password) {
    res.status(400).json({ error: 'Username, email, and password are required.' });
    return;
  }

  if (password.length < 8) { res.status(400).json({ error: 'Password minimal harus 8 karakter.' }); return; }
  if (!/[A-Z]/.test(password)) { res.status(400).json({ error: 'Password harus mengandung minimal 1 huruf besar (A-Z).' }); return; }
  if (!/[a-z]/.test(password)) { res.status(400).json({ error: 'Password harus mengandung minimal 1 huruf kecil (a-z).' }); return; }
  if (!/[0-9]/.test(password)) { res.status(400).json({ error: 'Password harus mengandung minimal 1 angka (0-9).' }); return; }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) { res.status(400).json({ error: 'Password harus mengandung minimal 1 simbol/karakter khusus (!@#$%^&*).' }); return; }

  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();

  if (cleanUsername.length < 2) { res.status(400).json({ error: 'Username minimal harus 2 karakter.' }); return; }

  const existingEmail = await db.getUserByEmail(cleanEmail);
  if (existingEmail) { res.status(409).json({ error: 'Email sudah terdaftar. Silakan gunakan email lain atau masuk ke akun Anda.' }); return; }

  const existingUsername = await db.getUserByUsername(cleanUsername);
  if (existingUsername) { res.status(409).json({ error: 'Username sudah digunakan. Silakan pilih username lain.' }); return; }

  const discriminator = Math.floor(1000 + Math.random() * 9000).toString();
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  const defaultAvatars = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=150&auto=format&fit=crop&q=80'
  ];
  const userAvatar = avatar || defaultAvatars[Math.floor(Math.random() * defaultAvatars.length)];

  const newUser: User = {
    id: `user_${uuidv4()}`,
    username: cleanUsername,
    discriminator,
    email: cleanEmail,
    passwordHash,
    avatar: userAvatar,
    bannerColor: '#5865F2',
    status: 'online',
    customStatus: '',
    bio: '',
    createdAt: new Date().toISOString()
  };

  await db.addUser(newUser);

  // Auto-join default server
  const mainServer = await db.getServerById('srv_main');
  if (mainServer) {
    const updatedMembers = [...(mainServer.members || []), {
      userId: newUser.id,
      serverId: 'srv_main',
      roleIds: ['role_member'],
      joinedAt: new Date().toISOString()
    }];
    await db.updateServer('srv_main', { members: updatedMembers });
  }

  const token = generateToken(newUser);
  const { passwordHash: _, ...safeUser } = newUser;
  res.status(201).json({ token, user: safeUser });
};

export const login = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { login: identifier, password } = req.body;

  if (!identifier || !password) { res.status(400).json({ error: 'Username/Email dan password harus diisi.' }); return; }

  const cleanIdentifier = typeof identifier === 'string' ? identifier.trim() : '';
  const user = cleanIdentifier.includes('@')
    ? await db.getUserByEmail(cleanIdentifier.toLowerCase())
    : await db.getUserByUsername(cleanIdentifier);

  if (!user) { res.status(401).json({ error: 'Email/Username atau password tidak valid.' }); return; }

  if (user.lockedUntil && Date.now() < user.lockedUntil) {
    const remainingMins = Math.ceil((user.lockedUntil - Date.now()) / (60 * 1000));
    res.status(429).json({ error: `Akun Anda terkunci sementara. Silakan coba lagi dalam ${remainingMins} menit.` });
    return;
  }

  const isMatch = bcrypt.compareSync(password, user.passwordHash);
  if (!isMatch) {
    const failedAttempts = (user.failedLoginAttempts || 0) + 1;
    let lockedUntil: number | undefined = undefined;
    let errorMsg = 'Email/Username atau password salah.';
    if (failedAttempts >= 5) {
      lockedUntil = Date.now() + 15 * 60 * 1000;
      errorMsg = 'Percobaan login salah mencapai batas maksimum (5x). Akun dikunci 15 menit.';
    } else {
      errorMsg = `Email/Username atau password salah. Sisa kesempatan: ${5 - failedAttempts}x.`;
    }
    await db.updateUser(user.id, { failedLoginAttempts: failedAttempts, lockedUntil });
    res.status(401).json({ error: errorMsg, remainingAttempts: Math.max(0, 5 - failedAttempts) });
    return;
  }

  await db.updateUser(user.id, { failedLoginAttempts: 0, lockedUntil: undefined });

  if (user.twoFactorEnabled && !user.isGuest) {
    const challengeId = `2fa_${uuidv4()}`;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    twoFactorChallenges.set(challengeId, { userId: user.id, code, expiresAt: Date.now() + 10 * 60 * 1000 });
    res.json({
      twoFactorRequired: true,
      challengeId,
      twoFactorType: user.twoFactorType || 'google',
      maskedEmail: maskEmail(user.email),
      code,
      message: user.twoFactorType === 'file'
        ? 'Silakan unggah file kunci keamanan (.aerocord-key) untuk masuk.'
        : 'Masukkan 6-digit kode verifikasi dari Google Authenticator Anda.'
    });
    return;
  }

  const token = generateToken(user);
  const { passwordHash: _, twoFactorSecret: __, ...safeUser } = user;
  res.json({ token, user: safeUser });
};

export const verify2FALogin = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { challengeId, code, keyFileContent } = req.body;
  if (!challengeId) { res.status(400).json({ error: 'Challenge ID 2FA diperlukan.' }); return; }

  const challenge = twoFactorChallenges.get(challengeId);
  if (!challenge || Date.now() > challenge.expiresAt) { res.status(400).json({ error: 'Sesi verifikasi 2FA telah kedaluwarsa. Silakan login kembali.' }); return; }

  const user = await db.getUserById(challenge.userId);
  if (!user) { res.status(404).json({ error: 'Pengguna tidak ditemukan.' }); return; }

  let isVerified = false;

  if (keyFileContent) {
    const keyResult = verifySecurityKeyFile(keyFileContent, user.id);
    if (keyResult.valid) { isVerified = true; }
    else { res.status(400).json({ error: keyResult.error || 'File kunci keamanan tidak valid.' }); return; }
  }

  if (!isVerified && code) {
    const cleanCode = code.trim();
    if (user.twoFactorSecret) {
      try {
        const payload: EncryptedPayload = JSON.parse(user.twoFactorSecret);
        const secretBase32 = decryptAES256GCM(payload);
        if (secretBase32 && verifyTOTPCode(secretBase32, cleanCode)) isVerified = true;
      } catch (err) { console.error('Error decrypting TOTP secret:', err); }
    }
    if (!isVerified && challenge.code === cleanCode) isVerified = true;
  }

  if (!isVerified) { res.status(400).json({ error: 'Kode autentikasi atau file kunci 2FA tidak cocok.' }); return; }

  twoFactorChallenges.delete(challengeId);
  const token = generateToken(user);
  const { passwordHash: _, twoFactorSecret: __, ...safeUser } = user;
  res.json({ success: true, token, user: safeUser, message: 'Autentikasi 2FA berhasil diverifikasi.' });
};

export const setup2FAGoogle = (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user || req.user.isGuest) { res.status(403).json({ error: 'Fitur 2FA hanya tersedia untuk akun permanen.' }); return; }
  const secretBase32 = generateBase32Secret(20);
  const otpauthUrl = `otpauth://totp/AeroCord:${encodeURIComponent(req.user.email)}?secret=${secretBase32}&issuer=AeroCord&algorithm=SHA1&digits=6&period=30`;
  pending2FASetups.set(req.user.id, { secret: secretBase32, type: 'google', expiresAt: Date.now() + 15 * 60 * 1000 });
  res.json({ success: true, secret: secretBase32, otpauthUrl, message: 'Pindai QR code atau masukkan kode rahasia ke aplikasi Google Authenticator Anda.' });
};

export const confirm2FAGoogle = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { code } = req.body;
  const pending = pending2FASetups.get(req.user.id);
  if (!pending || pending.type !== 'google' || Date.now() > pending.expiresAt) { res.status(400).json({ error: 'Sesi setup 2FA telah kedaluwarsa. Silakan mulai ulang konfigurasi.' }); return; }
  const isValid = verifyTOTPCode(pending.secret, code);
  if (!isValid) { res.status(400).json({ error: 'Kode verifikasi 6 digit salah. Pastikan waktu pada perangkat Anda akurat.' }); return; }
  const encryptedSecret = encryptAES256GCM(pending.secret);
  const updated = await db.updateUser(req.user.id, { twoFactorEnabled: true, twoFactorType: 'google', twoFactorSecret: JSON.stringify(encryptedSecret) });
  pending2FASetups.delete(req.user.id);
  const { passwordHash: _, twoFactorSecret: __, ...safeUser } = updated || req.user;
  res.json({ success: true, user: safeUser, message: 'Google Authenticator 2FA berhasil diaktifkan untuk akun Anda!' });
};

export const setup2FAFile = (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user || req.user.isGuest) { res.status(403).json({ error: 'Fitur 2FA hanya tersedia untuk akun permanen.' }); return; }
  const { fileContent, keyId, rawToken } = generateSecurityKeyFile(req.user.id, req.user.username);
  pending2FASetups.set(req.user.id, { secret: rawToken, keyId, type: 'file', expiresAt: Date.now() + 15 * 60 * 1000 });
  res.json({ success: true, filename: `aerocord-${req.user.username.toLowerCase().replace(/\s+/g, '_')}.aerocord-key`, fileContent, keyId, message: 'Unduh file kunci keamanan (.aerocord-key) Anda dan simpan di tempat yang aman.' });
};

export const confirm2FAFile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const pending = pending2FASetups.get(req.user.id);
  if (!pending || pending.type !== 'file' || Date.now() > pending.expiresAt) { res.status(400).json({ error: 'Sesi setup file kunci telah kedaluwarsa. Silakan mulai ulang.' }); return; }
  const updated = await db.updateUser(req.user.id, { twoFactorEnabled: true, twoFactorType: 'file', twoFactorKeyId: pending.keyId });
  pending2FASetups.delete(req.user.id);
  const { passwordHash: _, twoFactorSecret: __, ...safeUser } = updated || req.user;
  res.json({ success: true, user: safeUser, message: 'File Kunci Keamanan 2FA berhasil diaktifkan!' });
};

export const disable2FA = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const user = await db.getUserById(req.user.id);
  if (!user || !user.twoFactorEnabled) { res.status(400).json({ error: '2FA tidak aktif pada akun ini.' }); return; }
  const { code, keyFileContent } = req.body;

  if (user.twoFactorType === 'google') {
    if (!code || !code.trim()) { res.status(400).json({ error: 'Masukkan kode 6-digit dari Google Authenticator untuk menonaktifkan 2FA.' }); return; }
    if (!user.twoFactorSecret) { res.status(500).json({ error: 'Kunci rahasia 2FA tidak ditemukan.' }); return; }
    try {
      const payload: EncryptedPayload = JSON.parse(user.twoFactorSecret);
      const secretBase32 = decryptAES256GCM(payload);
      if (!secretBase32 || !verifyTOTPCode(secretBase32, code.trim())) { res.status(400).json({ error: 'Kode Google Authenticator salah atau tidak valid.' }); return; }
    } catch (err) { res.status(500).json({ error: 'Gagal mendekripsi kunci rahasia 2FA.' }); return; }
  }

  if (user.twoFactorType === 'file') {
    if (!keyFileContent) { res.status(400).json({ error: 'Unggah file kunci keamanan (.aerocord-key) yang sama dengan saat aktivasi.' }); return; }
    const keyResult = verifySecurityKeyFile(keyFileContent, user.id);
    if (!keyResult.valid) { res.status(400).json({ error: keyResult.error || 'File kunci keamanan tidak valid.' }); return; }
    if (user.twoFactorKeyId && keyResult.keyId !== user.twoFactorKeyId) { res.status(400).json({ error: 'File kunci keamanan yang diunggah tidak cocok.' }); return; }
  }

  const updated = await db.updateUser(req.user.id, { twoFactorEnabled: false, twoFactorType: undefined, twoFactorSecret: undefined, twoFactorKeyId: undefined });
  const { passwordHash: _, twoFactorSecret: __, ...safeUser } = updated || req.user;
  res.json({ success: true, twoFactorEnabled: false, user: safeUser, message: 'Autentikasi Dua Langkah (2FA) telah berhasil dinonaktifkan.' });
};

export const toggleTwoFactor = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  if (req.user.isGuest) { res.status(403).json({ error: 'Fitur 2FA hanya tersedia untuk akun permanen.' }); return; }
  const { enable } = req.body;
  if (!enable) { await disable2FA(req, res); }
  else { res.json({ success: true, message: 'Silakan pilih metode 2FA: Google Authenticator atau File Kunci.' }); }
};

export const changePassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  if (req.user.isGuest) { res.status(403).json({ error: 'Akun tamu tidak dapat mengubah password.' }); return; }
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) { res.status(400).json({ error: 'Password saat ini dan password baru harus diisi.' }); return; }
  const user = await db.getUserById(req.user.id);
  if (!user) { res.status(404).json({ error: 'User tidak ditemukan.' }); return; }
  if (!bcrypt.compareSync(currentPassword, user.passwordHash)) { res.status(400).json({ error: 'Password saat ini yang Anda masukkan salah.' }); return; }
  if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
    res.status(400).json({ error: 'Password baru harus memenuhi standar keamanan (minimal 8 karakter, huruf besar, huruf kecil, angka, dan simbol).' }); return;
  }
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(newPassword, salt);
  await db.updateUser(user.id, { passwordHash, failedLoginAttempts: 0, lockedUntil: undefined });
  res.json({ success: true, message: 'Password berhasil diperbarui dengan aman!' });
};

export const guestLogin = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { guestId, customName } = req.body;
  let targetUser: User | undefined;

  if (guestId) targetUser = await db.getUserById(guestId);

  if (!targetUser && customName) {
    const cleanName = customName.trim();
    if (cleanName.length < 2) { res.status(400).json({ error: 'Nama tamu minimal harus 2 karakter.' }); return; }
    const existing = await db.getUserByUsername(cleanName);
    if (existing) { res.status(409).json({ error: 'Nama pengguna/tamu tersebut sudah digunakan. Silakan gunakan nama lain.' }); return; }

    const discriminator = Math.floor(1000 + Math.random() * 9000).toString();
    const guestUser: User = {
      id: `guest_${uuidv4()}`,
      username: cleanName,
      discriminator,
      email: `${cleanName.toLowerCase().replace(/\s+/g, '')}_${discriminator}@guest.aerocord.app`,
      passwordHash: bcrypt.hashSync('guestpass123', 10),
      avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${cleanName}`,
      bannerColor: '#5865F2',
      status: 'online',
      customStatus: '✨ Tamu (Guest)',
      bio: 'Akun Tamu Sementara',
      isGuest: true,
      emailVerified: false,
      createdAt: new Date().toISOString()
    };
    await db.addUser(guestUser);

    const mainServer = await db.getServerById('srv_main');
    if (mainServer) {
      const updatedMembers = [...(mainServer.members || []), { userId: guestUser.id, serverId: 'srv_main', roleIds: ['role_member'], joinedAt: new Date().toISOString() }];
      await db.updateServer('srv_main', { members: updatedMembers });
    }
    targetUser = guestUser;
  }

  if (!targetUser && !customName) targetUser = await db.getUserById('user_alice');
  if (!targetUser) { res.status(404).json({ error: 'Guest user not found.' }); return; }

  const token = generateToken(targetUser);
  const { passwordHash: _, ...safeUser } = targetUser;
  res.json({ token, user: safeUser });
};

export const logout = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (req.user) {
    if (req.user.isGuest || req.user.id.startsWith('guest_') || req.user.email.endsWith('@guest.aerocord.app')) {
      await db.deleteUser(req.user.id);
    }
  }
  res.json({ success: true, message: 'Logged out successfully.' });
};

export const sendVerificationCode = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { email } = req.body;
  if (!email || !email.includes('@')) { res.status(400).json({ error: 'Alamat email yang valid diperlukan.' }); return; }
  const cleanEmail = email.trim().toLowerCase();
  const existing = await db.getUserByEmail(cleanEmail);
  if (existing && existing.id !== req.user?.id) { res.status(409).json({ error: 'Email sudah terdaftar pada akun lain.' }); return; }
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  verificationCodes.set(cleanEmail, { code, expiresAt: Date.now() + 10 * 60 * 1000 });
  res.json({ success: true, message: 'Kode verifikasi telah dikirim ke email Anda.', code });
};

export const upgradeGuestAccount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { email, password, verificationCode } = req.body;
  if (!email || !password || !verificationCode) { res.status(400).json({ error: 'Email, password, dan kode verifikasi harus diisi.' }); return; }
  const cleanEmail = email.trim().toLowerCase();
  const stored = verificationCodes.get(cleanEmail);
  if (!stored || stored.code !== verificationCode.trim() || Date.now() > stored.expiresAt) { res.status(400).json({ error: 'Kode verifikasi tidak valid atau telah kedaluwarsa.' }); return; }
  if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    res.status(400).json({ error: 'Password harus memenuhi syarat keamanan (8+ karakter, huruf besar, huruf kecil, angka, dan simbol).' }); return;
  }
  const existing = await db.getUserByEmail(cleanEmail);
  if (existing && existing.id !== req.user.id) { res.status(409).json({ error: 'Email sudah digunakan oleh akun lain.' }); return; }
  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);
  const updated = await db.updateUser(req.user.id, { email: cleanEmail, passwordHash, isGuest: false, emailVerified: true, customStatus: '🚀 Anggota Terverifikasi' });
  if (!updated) { res.status(404).json({ error: 'User tidak ditemukan.' }); return; }
  verificationCodes.delete(cleanEmail);
  const token = generateToken(updated);
  const { passwordHash: _, ...safeUser } = updated;
  res.json({ success: true, message: 'Akun Anda berhasil ditingkatkan ke akun permanen!', token, user: safeUser });
};

export const resetDatabase = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  await db.resetDatabase();
  res.json({ success: true, message: 'Database telah direset ke kondisi awal.' });
};

export const getMe = (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { passwordHash: _, ...safeUser } = req.user;
  res.json({ user: safeUser });
};

export const updateProfile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { avatar, bannerColor, customStatus, bio, status, username } = req.body;
  const updates: Partial<User> = {};
  if (avatar !== undefined) updates.avatar = avatar;
  if (bannerColor !== undefined) updates.bannerColor = bannerColor;
  if (customStatus !== undefined) updates.customStatus = customStatus;
  if (bio !== undefined) updates.bio = bio;
  if (status !== undefined) updates.status = status;
  if (username !== undefined) {
    const cleanUsername = username.trim();
    if (cleanUsername.length < 2) { res.status(400).json({ error: 'Username minimal harus 2 karakter.' }); return; }
    const existing = await db.getUserByUsername(cleanUsername);
    if (existing && existing.id !== req.user.id) { res.status(409).json({ error: 'Username sudah digunakan oleh akun lain. Silakan pilih username lain.' }); return; }
    updates.username = cleanUsername;
  }
  const updated = await db.updateUser(req.user.id, updates);
  if (!updated) { res.status(404).json({ error: 'User not found.' }); return; }
  const { passwordHash: _, ...safeUser } = updated;
  res.json({ user: safeUser });
};

export const getFriends = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const rawRelations = await db.getFriends(req.user.id);
  const populated = await Promise.all(rawRelations.map(async rel => {
    const friendId = rel.userId === req.user!.id ? rel.friendId : rel.userId;
    const friendUser = await db.getUserById(friendId);
    let safeFriend = undefined;
    if (friendUser) {
      const { passwordHash: _, ...safe } = friendUser;
      safeFriend = safe;
    }
    return { relationId: rel.id, status: rel.status, isSender: rel.userId === req.user!.id, createdAt: rel.createdAt, friend: safeFriend };
  }));
  res.json({ friends: populated.filter(r => r.friend !== undefined) });
};

export const sendFriendRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { username, discriminator, userId } = req.body;
  let targetUser: User | undefined;
  if (userId) { targetUser = await db.getUserById(userId); }
  else if (username && discriminator) { const users = await db.getUsers(); targetUser = users.find(u => u.username.toLowerCase() === username.toLowerCase().trim() && u.discriminator === discriminator.trim()); }
  else if (username) { targetUser = await db.getUserByUsername(username); }
  if (!targetUser) { res.status(404).json({ error: 'User not found with that username or ID.' }); return; }
  if (targetUser.id === req.user.id) { res.status(400).json({ error: "You can't add yourself as a friend." }); return; }
  const existing = (await db.getFriends(req.user.id)).find(f => f.userId === targetUser!.id || f.friendId === targetUser!.id);
  if (existing) {
    if (existing.status === 'accepted') { res.status(400).json({ error: 'You are already friends with this user.' }); return; }
    res.status(400).json({ error: 'A friend request is already pending between you.' }); return;
  }
  const relation: FriendRelation = { id: `fr_${uuidv4()}`, userId: req.user.id, friendId: targetUser.id, status: 'pending', createdAt: new Date().toISOString() };
  await db.addFriendRelation(relation);
  res.status(201).json({ message: 'Friend request sent successfully.', relation });
};

export const respondFriendRequest = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { relationId, action } = req.body;
  const relations = await db.getFriends(req.user.id);
  const rel = relations.find(r => r.id === relationId);
  if (!rel) { res.status(404).json({ error: 'Friend request not found.' }); return; }
  if (action === 'accept') { await db.updateFriendRelation(rel.id, 'accepted'); res.json({ message: 'Friend request accepted.' }); }
  else if (action === 'decline') { await db.removeFriendRelation(rel.userId, rel.friendId); res.json({ message: 'Friend request declined.' }); }
  else if (action === 'block') { await db.updateFriendRelation(rel.id, 'blocked'); res.json({ message: 'User blocked.' }); }
  else { res.status(400).json({ error: 'Invalid action.' }); }
};

export const searchUsers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const query = (req.query.q as string || '').toLowerCase().trim();
  if (!query) { res.json({ users: [] }); return; }
  const allUsers = await db.getUsers();
  const results = allUsers
    .filter(u => u.username.toLowerCase().includes(query) || `${u.username}#${u.discriminator}`.toLowerCase().includes(query))
    .slice(0, 10)
    .map(u => { const { passwordHash: _, ...safe } = u; return safe; });
  res.json({ users: results });
};
