import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database';
import { AuthenticatedRequest } from '../middleware/auth';
import { Attachment } from '../types';
import { uploadToSupabaseStorage } from '../middleware/upload';

export const uploadAttachment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  // Restrict guest users from sending attachments/uploading files
  if (req.user.isGuest || req.user.id.startsWith('guest_') || req.user.email.endsWith('@guest.aerocord.app')) {
    res.status(403).json({ error: 'Akun tamu tidak diizinkan mengunggah lampiran/file. Silakan tingkatkan akun Anda ke akun permanen terlebih dahulu di pengaturan akun.' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'Tidak ada file yang diunggah atau format file ditolak.' });
    return;
  }

  try {
    const fileUrl = await uploadToSupabaseStorage(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      'attachments'
    );

    const attachment: Attachment = {
      id: `att_${uuidv4()}`,
      url: fileUrl,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      size: req.file.size
    };

    res.status(201).json({
      success: true,
      url: fileUrl,
      attachment
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal mengunggah file.' });
  }
};

export const getStickerPacks = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  const packs = await db.getStickerPacks();
  res.json({ stickerPacks: packs });
};

export const createCustomSticker = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  const { name, packId, url } = req.body;
  let stickerUrl = url;

  if (req.file) {
    try {
      stickerUrl = await uploadToSupabaseStorage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        'stickers'
      );
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Gagal mengunggah stiker.' });
      return;
    }
  }

  if (!name || !stickerUrl) {
    res.status(400).json({ error: 'Sticker name and image file/URL are required.' });
    return;
  }

  const sticker = {
    id: `stk_${uuidv4()}`,
    name: name.trim(),
    url: stickerUrl,
    packId: packId || 'pack_custom'
  };

  await db.addCustomSticker(sticker.packId, sticker);
  res.status(201).json({ sticker });
};
