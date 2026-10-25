import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { supabase, STORAGE_BUCKET } from '../config/supabase';
import { Request, Response, NextFunction } from 'express';

// Comprehensive blacklist of dangerous executable and web-scripting extensions
const BLOCKED_EXTENSIONS = [
  '.exe', '.bat', '.cmd', '.sh', '.vbs', '.msi', '.dll', '.scr', '.com', '.pif',
  '.ps1', '.bin', '.html', '.htm', '.xhtml', '.php', '.phtml', '.php3', '.php4',
  '.php5', '.phps', '.jsp', '.asp', '.aspx', '.cgi', '.pl', '.svg', '.js', '.mjs'
];

// Blocked active scripting MIME types (e.g. SVG scripts, executable mime types)
const BLOCKED_MIMETYPES = [
  'text/html',
  'application/javascript',
  'text/javascript',
  'image/svg+xml',
  'application/x-msdownload',
  'application/x-sh',
  'application/x-php'
];

/**
 * Multer using memory storage — file is held in buffer,
 * then uploaded to Supabase Storage (no disk I/O).
 */
export const uploadMedia = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB maximum
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    if (BLOCKED_EXTENSIONS.includes(ext) || BLOCKED_MIMETYPES.includes(mime)) {
      cb(new Error('Format file tidak diizinkan demi alasan keamanan. Silakan unggah file gambar umum (PNG, JPG, WebP, GIF), audio, video, dokumen, atau arsip zip.'));
    } else {
      cb(null, true);
    }
  }
});

/**
 * Upload a buffer to Supabase Storage and return a public URL.
 */
export const uploadToSupabaseStorage = async (
  buffer: Buffer,
  originalName: string,
  mimetype: string,
  folder = 'attachments'
): Promise<string> => {
  const ext = path.extname(originalName).toLowerCase();
  const filename = `${folder}/${uuidv4()}${ext}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(filename, buffer, {
      contentType: mimetype,
      upsert: false
    });

  if (error) {
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  }

  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(filename);

  return urlData.publicUrl;
};
