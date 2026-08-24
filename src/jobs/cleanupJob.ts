import { supabase, STORAGE_BUCKET } from '../config/supabase';
import { db } from '../config/database';
import { Message, DirectMessageConversation } from '../types';

/**
 * Extracts storage relative file path from public Supabase URL
 * e.g. 'https://.../storage/v1/object/public/aerocord-uploads/attachments/xyz.png' -> 'attachments/xyz.png'
 */
export const extractStoragePath = (url?: string): string | null => {
  if (!url) return null;
  try {
    const bucketPrefix = `${STORAGE_BUCKET}/`;
    if (url.includes(bucketPrefix)) {
      return url.split(bucketPrefix)[1]?.split('?')[0] || null;
    }
    const match = url.match(/(attachments\/[a-zA-Z0-9_\-\.]+)/);
    if (match) return match[1];
    return null;
  } catch {
    return null;
  }
};

/**
 * Cleans up media attachments and images older than 30 days
 * from Server Channel Messages and Direct Messages (Private Chats).
 */
export const cleanupExpiredMedia = async (daysThreshold = 30): Promise<{
  serverFilesRemoved: number;
  dmFilesRemoved: number;
  storageFilesRemoved: number;
}> => {
  const cutoffDate = new Date(Date.now() - daysThreshold * 24 * 60 * 60 * 1000);
  const cutoffIso = cutoffDate.toISOString();
  console.log(`🧹 [Auto-Cleanup] Starting media cleanup for files older than ${daysThreshold} days (Before: ${cutoffIso})...`);

  const filesToDelete: Set<string> = new Set();
  let serverFilesRemoved = 0;
  let dmFilesRemoved = 0;
  let storageFilesRemoved = 0;

  try {
    // ============================================================
    // 1. Server Channel Messages Cleanup
    // ============================================================
    const { data: oldServerMessages, error: srvMsgError } = await supabase
      .from('messages')
      .select('id, attachments, "createdAt"')
      .lt('createdAt', cutoffIso);

    if (!srvMsgError && oldServerMessages) {
      for (const msg of oldServerMessages) {
        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        if (attachments.length > 0) {
          for (const att of attachments) {
            const path = extractStoragePath(att.url);
            if (path && path.startsWith('attachments/')) {
              filesToDelete.add(path);
              serverFilesRemoved++;
            }
          }
          // Clear attachments in message database record
          await supabase
            .from('messages')
            .update({ attachments: [] })
            .eq('id', msg.id);
        }
      }
    }

    // ============================================================
    // 2. Direct Messages (Conversations) Cleanup
    // ============================================================
    const { data: allConversations, error: convError } = await supabase
      .from('conversations')
      .select('id, messages');

    if (!convError && allConversations) {
      for (const conv of allConversations) {
        const messages: Message[] = Array.isArray(conv.messages) ? conv.messages : [];
        let hasModified = false;

        const updatedMessages = messages.map(msg => {
          if (msg.createdAt && new Date(msg.createdAt) < cutoffDate && msg.attachments && msg.attachments.length > 0) {
            for (const att of msg.attachments) {
              const path = extractStoragePath(att.url);
              if (path && path.startsWith('attachments/')) {
                filesToDelete.add(path);
                dmFilesRemoved++;
              }
            }
            hasModified = true;
            return { ...msg, attachments: [] };
          }
          return msg;
        });

        if (hasModified) {
          await supabase
            .from('conversations')
            .update({ messages: updatedMessages })
            .eq('id', conv.id);
        }
      }
    }

    // ============================================================
    // 3. Remove files from Supabase Storage in batches of 50
    // ============================================================
    if (filesToDelete.size > 0) {
      const fileList = Array.from(filesToDelete);
      for (let i = 0; i < fileList.length; i += 50) {
        const chunk = fileList.slice(i, i + 50);
        const { error: deleteError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove(chunk);

        if (deleteError) {
          console.error('⚠️ [Auto-Cleanup] Error deleting batch from storage:', deleteError);
        } else {
          storageFilesRemoved += chunk.length;
        }
      }
    }

    // ============================================================
    // 4. Safety Sweep: Scan 'attachments' folder in Storage for any orphaned files > 30 days
    // ============================================================
    try {
      const { data: storageList } = await supabase.storage
        .from(STORAGE_BUCKET)
        .list('attachments', { limit: 100, sortBy: { column: 'created_at', order: 'asc' } });

      if (storageList && storageList.length > 0) {
        const orphanedToDelete: string[] = [];
        for (const item of storageList) {
          if (item.created_at && new Date(item.created_at) < cutoffDate && item.name) {
            orphanedToDelete.push(`attachments/${item.name}`);
          }
        }

        if (orphanedToDelete.length > 0) {
          await supabase.storage.from(STORAGE_BUCKET).remove(orphanedToDelete);
          storageFilesRemoved += orphanedToDelete.length;
        }
      }
    } catch (sweepErr) {
      console.warn('⚠️ [Auto-Cleanup] Storage safety sweep note:', sweepErr);
    }

    console.log(`✅ [Auto-Cleanup Complete] Removed ${storageFilesRemoved} expired files (${serverFilesRemoved} server files, ${dmFilesRemoved} DM files).`);

    return { serverFilesRemoved, dmFilesRemoved, storageFilesRemoved };
  } catch (err) {
    console.error('❌ [Auto-Cleanup] Critical error during cleanup:', err);
    return { serverFilesRemoved: 0, dmFilesRemoved: 0, storageFilesRemoved: 0 };
  }
};

/**
 * Starts the automatic 24-hour media cleanup timer
 */
export const startMediaCleanupScheduler = (): void => {
  // Run first cleanup 15 seconds after server startup
  setTimeout(() => {
    cleanupExpiredMedia(30).catch(err => console.error('Startup cleanup failed:', err));
  }, 15000);

  // Run recurring cleanup every 24 hours (86,400,000 ms)
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    cleanupExpiredMedia(30).catch(err => console.error('Daily cleanup failed:', err));
  }, TWENTY_FOUR_HOURS);

  console.log('⏰ [Auto-Cleanup] 30-Day Media Retention Scheduler initialized (Running every 24h).');
};
