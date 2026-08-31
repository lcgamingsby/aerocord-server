import { Server as SocketIOServer, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database';
import { verifyJWTToken } from '../middleware/auth';
import { Message, UserStatus } from '../types';

interface VoiceParticipant {
  userId: string;
  socketId: string;
  channelId: string;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  isSpeaking: boolean;
}

// In-memory voice room registry: channelId -> Map<userId, VoiceParticipant>
const voiceRooms = new Map<string, Map<string, VoiceParticipant>>();

// Active user sockets: userId -> Set<socketId>
const userSockets = new Map<string, Set<string>>();

export const setupSocketHandlers = (io: SocketIOServer): void => {
  // Middleware for socket authentication (async)
  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) return next(new Error('Authentication token required'));

    const decoded = verifyJWTToken(token as string);
    if (!decoded) return next(new Error('Invalid token'));

    const user = await db.getUserById(decoded.id);
    if (!user) return next(new Error('User not found'));

    socket.data.user = user;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const user = socket.data.user;
    const userId = user.id;

    // Track user socket
    if (!userSockets.has(userId)) userSockets.set(userId, new Set());
    userSockets.get(userId)!.add(socket.id);

    // Update user status to online
    db.updateUser(userId, { status: 'online' }).catch(console.error);
    io.emit('user_presence_change', { userId, status: 'online', customStatus: user.customStatus });

    // Auto-join user to their own personal notification room
    socket.join(`user:${userId}`);

    socket.on('join_channel', (channelId: string) => socket.join(`channel:${channelId}`));
    socket.on('leave_channel', (channelId: string) => socket.leave(`channel:${channelId}`));

    // ==========================================
    // REAL-TIME MESSAGING & INTERACTIONS
    // ==========================================

    socket.on('send_message', async (data: {
      channelId: string;
      content: string;
      attachments?: any[];
      stickerUrl?: string;
      replyToId?: string;
      poll?: any;
      linkPreviews?: any[];
    }) => {
      try {
        let { channelId, content, attachments = [], stickerUrl, replyToId, poll, linkPreviews } = data;

        const authorUser = await db.getUserById(userId);
        const isGuest = authorUser?.isGuest || authorUser?.id.startsWith('guest_') || authorUser?.email.endsWith('@guest.aerocord.app');

        // Strip attachments if sender is guest
        if (isGuest && attachments && attachments.length > 0) {
          attachments = [];
          socket.emit('toast_notification', {
            title: 'Batasan Akun Tamu',
            message: 'Akun tamu tidak dapat mengirim lampiran file/gambar. Tingkatkan akun Anda ke permanen.',
            variant: 'error'
          });
        }

        if (!content && attachments.length === 0 && !stickerUrl && !poll) return;

        let replyToMessage: Partial<Message> | undefined;
        if (replyToId) {
          try {
            const originalMsg = await db.getMessageById(replyToId);
            if (originalMsg) {
              const author = await db.getUserById(originalMsg.authorId);
              replyToMessage = {
                id: originalMsg.id,
                content: originalMsg.content,
                authorId: originalMsg.authorId,
                author: author ? (({ passwordHash: _, ...safe }) => safe)(author) : undefined
              };
            }
          } catch (e) {
            console.warn('Error fetching replyToMessage:', e);
          }
        }

        const newMessage: Message = {
          id: `msg_${uuidv4()}`,
          channelId,
          authorId: userId,
          content: content ? content.trim() : '',
          attachments,
          stickerUrl,
          replyToId,
          replyToMessage,
          reactions: [],
          poll,
          linkPreviews,
          isPinned: false,
          isEdited: false,
          createdAt: new Date().toISOString()
        };

        await db.addMessage(newMessage);

        const safeAuthor = authorUser ? (({ passwordHash: _, ...safe }) => safe)(authorUser) : undefined;
        const fullMessage = { ...newMessage, author: safeAuthor };

        io.to(`channel:${channelId}`).emit('new_message', fullMessage);

        // If DM conversation, update lastMessageAt and notify recipients
        if (channelId.startsWith('dm_') || channelId.startsWith('group_dm_')) {
          const convo = await db.getConversationById(channelId);
          if (convo) {
            const rIds = (convo as any).recipientIds || (convo as any).participantIds || [];
            await db.updateConversation(channelId, { lastMessageAt: newMessage.createdAt } as any);
            rIds.forEach((recId: string) => {
              io.to(`user:${recId}`).emit('dm_conversation_updated', {
                conversationId: channelId,
                lastMessage: fullMessage
              });
              io.to(`user:${recId}`).emit('new_message', fullMessage);
            });
          }
        }
      } catch (err: any) {
        console.error('Error handling send_message:', err);
      }
    });

    socket.on('edit_message', async (data: { messageId: string; content: string }) => {
      const { messageId, content } = data;
      const msg = await db.getMessageById(messageId);
      if (!msg || msg.authorId !== userId) return;

      const updated = await db.updateMessage(messageId, { content: content.trim(), isEdited: true, editedAt: new Date().toISOString() });
      if (updated) {
        const author = await db.getUserById(updated.authorId);
        const safeAuthor = author ? (({ passwordHash: _, ...safe }) => safe)(author) : undefined;
        io.to(`channel:${updated.channelId}`).emit('message_updated', { ...updated, author: safeAuthor });
      }
    });

    socket.on('delete_message', async (data: { messageId: string }) => {
      const { messageId } = data;
      const msg = await db.getMessageById(messageId);
      if (!msg || msg.authorId !== userId) return;

      await db.deleteMessage(messageId);
      io.to(`channel:${msg.channelId}`).emit('message_deleted', { messageId, channelId: msg.channelId });
    });

    socket.on('toggle_pin_message', async (data: { messageId: string }) => {
      const { messageId } = data;
      const msg = await db.getMessageById(messageId);
      if (!msg) return;

      const updated = await db.updateMessage(messageId, { isPinned: !msg.isPinned });
      if (updated) {
        io.to(`channel:${updated.channelId}`).emit('message_pinned_updated', {
          messageId: updated.id,
          isPinned: updated.isPinned
        });
      }
    });

    socket.on('add_reaction', async (data: { messageId: string; emoji: string }) => {
      const { messageId, emoji } = data;
      const msg = await db.getMessageById(messageId);
      if (!msg) return;

      if (!msg.reactions) msg.reactions = [];

      const existingReaction = msg.reactions.find(r => r.emoji === emoji);
      if (existingReaction) {
        if (existingReaction.users.includes(userId)) {
          existingReaction.users = existingReaction.users.filter(uId => uId !== userId);
          if (existingReaction.users.length === 0) {
            msg.reactions = msg.reactions.filter(r => r.emoji !== emoji);
          }
        } else {
          existingReaction.users.push(userId);
        }
      } else {
        msg.reactions.push({ emoji, users: [userId] });
      }

      await db.updateMessage(messageId, { reactions: msg.reactions });
      io.to(`channel:${msg.channelId}`).emit('reaction_updated', { messageId, reactions: msg.reactions });
    });

    // Interactive Poll Voting
    socket.on('vote_poll', async (data: { messageId: string; optionId: string }) => {
      const { messageId, optionId } = data;
      const msg = await db.getMessageById(messageId);
      if (!msg || !msg.poll || msg.poll.closed) return;

      const poll = msg.poll;
      const isMulti = poll.isMultiChoice || poll.allowMultipleVotes;

      poll.options = poll.options.map((opt: any) => {
        const userVoted = opt.votes.includes(userId);
        if (opt.id === optionId) {
          return {
            ...opt,
            votes: userVoted ? opt.votes.filter((id: string) => id !== userId) : [...opt.votes, userId]
          };
        } else if (!isMulti) {
          // Single choice removes vote from other options
          return {
            ...opt,
            votes: opt.votes.filter((id: string) => id !== userId)
          };
        }
        return opt;
      });

      await db.updateMessage(messageId, { poll });
      io.to(`channel:${msg.channelId}`).emit('poll_updated', { messageId, poll });
    });

    // Typing Indicators
    socket.on('typing_start', (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit('user_typing', {
        channelId: data.channelId,
        user: { id: user.id, username: user.username }
      });
    });

    socket.on('typing_stop', (data: { channelId: string }) => {
      socket.to(`channel:${data.channelId}`).emit('user_stopped_typing', {
        channelId: data.channelId,
        userId: user.id
      });
    });

    // User status change
    socket.on('set_status', async (data: { status: UserStatus; customStatus?: string }) => {
      await db.updateUser(userId, { status: data.status, customStatus: data.customStatus });
      io.emit('user_presence_change', { userId, status: data.status, customStatus: data.customStatus });
    });

    // ==========================================
    // WEBRTC VOICE CHANNELS & SIGNALING (MESH)
    // ==========================================

    socket.on('voice_join_channel', async (data: { channelId: string; isMuted?: boolean; isDeafened?: boolean }) => {
      const { channelId, isMuted = false, isDeafened = false } = data;

      // Leave any existing voice rooms first
      for (const [rId, room] of voiceRooms.entries()) {
        if (room.has(userId)) {
          room.delete(userId);
          socket.leave(`voice:${rId}`);
          socket.to(`voice:${rId}`).emit('voice_peer_left', { userId, channelId: rId });
        }
      }

      if (!voiceRooms.has(channelId)) voiceRooms.set(channelId, new Map());

      const room = voiceRooms.get(channelId)!;
      const participant: VoiceParticipant = { userId, socketId: socket.id, channelId, isMuted, isDeafened, isScreenSharing: false, isSpeaking: false };
      room.set(userId, participant);
      socket.join(`voice:${channelId}`);

      // Get list of existing peers
      const currentPeers = await Promise.all(Array.from(room.values()).map(async p => {
        const u = await db.getUserById(p.userId);
        return { ...p, user: u ? (({ passwordHash: _, ...safe }) => safe)(u) : undefined };
      }));

      socket.emit('voice_channel_state', { channelId, participants: currentPeers });

      const authorUser = await db.getUserById(userId);
      const safeUser = authorUser ? (({ passwordHash: _, ...safe }) => safe)(authorUser) : undefined;
      socket.to(`voice:${channelId}`).emit('voice_peer_joined', { ...participant, user: safeUser });
    });

    socket.on('voice_leave_channel', (data: { channelId: string }) => {
      const { channelId } = data;
      const room = voiceRooms.get(channelId);
      if (room && room.has(userId)) {
        room.delete(userId);
        socket.leave(`voice:${channelId}`);
        socket.to(`voice:${channelId}`).emit('voice_peer_left', { userId, channelId });
      }
    });

    socket.on('voice_signal', (data: { targetUserId: string; signal: any; channelId: string }) => {
      const { targetUserId, signal, channelId } = data;
      const targetSockets = userSockets.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(targetSocketId => {
          io.to(targetSocketId).emit('voice_signal', { senderUserId: userId, signal, channelId });
        });
      }
    });

    socket.on('voice_state_update', (data: { channelId: string; isMuted?: boolean; isDeafened?: boolean; isScreenSharing?: boolean }) => {
      const { channelId, isMuted, isDeafened, isScreenSharing } = data;
      const room = voiceRooms.get(channelId);
      if (room && room.has(userId)) {
        const p = room.get(userId)!;
        if (isMuted !== undefined) p.isMuted = isMuted;
        if (isDeafened !== undefined) p.isDeafened = isDeafened;
        if (isScreenSharing !== undefined) p.isScreenSharing = isScreenSharing;
        io.to(`voice:${channelId}`).emit('voice_peer_state_changed', { userId, channelId, isMuted: p.isMuted, isDeafened: p.isDeafened, isScreenSharing: p.isScreenSharing });
      }
    });

    socket.on('voice_speaking', (data: { channelId: string; isSpeaking: boolean }) => {
      const { channelId, isSpeaking } = data;
      const room = voiceRooms.get(channelId);
      if (room && room.has(userId)) {
        const p = room.get(userId)!;
        p.isSpeaking = isSpeaking;
        socket.to(`voice:${channelId}`).emit('voice_peer_speaking', { userId, channelId, isSpeaking });
      }
    });

    socket.on('call_user', async (data: { targetUserId: string; conversationId: string; isVideo?: boolean }) => {
      const { targetUserId, conversationId, isVideo = false } = data;
      const caller = await db.getUserById(userId);
      const safeCaller = caller ? (({ passwordHash: _, ...safe }) => safe)(caller) : undefined;
      const targetSockets = userSockets.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(targetSocketId => {
          io.to(targetSocketId).emit('incoming_call', { caller: safeCaller, conversationId, isVideo });
        });
      }
    });

    socket.on('call_response', (data: { callerId: string; conversationId: string; accepted: boolean }) => {
      const { callerId, conversationId, accepted } = data;
      const callerSockets = userSockets.get(callerId);
      if (callerSockets) {
        callerSockets.forEach(callerSocketId => {
          io.to(callerSocketId).emit('call_answered', { calleeId: userId, conversationId, accepted });
        });
      }
    });

    socket.on('call_end', (data: { targetUserId: string; conversationId: string }) => {
      const { targetUserId, conversationId } = data;
      const targetSockets = userSockets.get(targetUserId);
      if (targetSockets) {
        targetSockets.forEach(targetSocketId => {
          io.to(targetSocketId).emit('call_ended', { userId, conversationId });
        });
      }
    });

    // ==========================================
    // DISCONNECT CLEANUP
    // ==========================================

    socket.on('disconnect', () => {
      const userSockSet = userSockets.get(userId);
      if (userSockSet) {
        userSockSet.delete(socket.id);
        if (userSockSet.size === 0) {
          userSockets.delete(userId);
          db.updateUser(userId, { status: 'offline' }).catch(console.error);
          io.emit('user_presence_change', { userId, status: 'offline' });
        }
      }

      for (const [rId, room] of voiceRooms.entries()) {
        if (room.has(userId) && room.get(userId)?.socketId === socket.id) {
          room.delete(userId);
          io.to(`voice:${rId}`).emit('voice_peer_left', { userId, channelId: rId });
          if (rId.startsWith('dm_') || rId.startsWith('group_dm_')) {
            io.to(`voice:${rId}`).emit('call_ended', { userId, conversationId: rId });
          }
        }
      }
    });
  });
};
