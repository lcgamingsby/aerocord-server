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

/**
 * Extracts OpenGraph metadata and YouTube ID from a URL
 */
export const getLinkPreview = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const url = req.query.url as string;
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    res.status(400).json({ error: 'Valid URL parameter is required.' });
    return;
  }

  try {
    const parsedUrl = new URL(url);
    const origin = parsedUrl.origin;

    // Check YouTube
    let youtubeId: string | undefined;
    if (parsedUrl.hostname.includes('youtube.com')) {
      youtubeId = parsedUrl.searchParams.get('v') || undefined;
    } else if (parsedUrl.hostname.includes('youtu.be')) {
      youtubeId = parsedUrl.pathname.slice(1) || undefined;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AeroCord/2.0 Bot'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      res.json({
        preview: {
          url,
          siteName: parsedUrl.hostname,
          youtubeId
        }
      });
      return;
    }

    const html = await response.text();

    const getMeta = (prop: string) => {
      const match = html.match(new RegExp(`<meta[^>]+(?:property|name)=["'](?:og:)?${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
        || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:)?${prop}["']`, 'i'));
      return match ? match[1] : undefined;
    };

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = getMeta('title') || (titleMatch ? titleMatch[1].trim() : undefined);
    const description = getMeta('description');
    let image = getMeta('image');

    if (image && !image.startsWith('http')) {
      image = new URL(image, origin).href;
    }

    let favicon = `${origin}/favicon.ico`;
    const iconMatch = html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
    if (iconMatch && iconMatch[1]) {
      favicon = iconMatch[1].startsWith('http') ? iconMatch[1] : new URL(iconMatch[1], origin).href;
    }

    const siteName = getMeta('site_name') || parsedUrl.hostname;

    res.json({
      preview: {
        url,
        title,
        description,
        image,
        siteName,
        favicon,
        youtubeId
      }
    });
  } catch (err: any) {
    res.json({
      preview: {
        url,
        siteName: new URL(url).hostname
      }
    });
  }
};

