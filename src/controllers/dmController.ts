import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database';
import { AuthenticatedRequest } from '../middleware/auth';
import { DirectMessageConversation } from '../types';

export const getConversations = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }

  const convos = await db.getConversations(req.user.id);
  const populated = await Promise.all(convos.map(async c => {
    const recipientIds = (c as any).recipientIds || (c as any).participantIds || [];
    const recipients = (await Promise.all(
      recipientIds.map(async (id: string) => {
        const u = await db.getUserById(id);
        if (!u) return null;
        const { passwordHash: _, ...safe } = u;
        return safe;
      })
    )).filter(Boolean);

    const messages = await db.getMessages(c.id, 1);
    const lastMessage = messages[0] || null;

    return { ...c, recipients, lastMessage };
  }));

  res.json({ conversations: populated });
};

export const createOrGetDM = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }

  const { targetUserId } = req.body;
  if (!targetUserId) { res.status(400).json({ error: 'Target user ID is required.' }); return; }

  const targetUser = await db.getUserById(targetUserId);
  if (!targetUser) { res.status(404).json({ error: 'User not found.' }); return; }

  const myConvos = await db.getConversations(req.user.id);
  const existing = myConvos.find(c => {
    const rIds = (c as any).recipientIds || (c as any).participantIds || [];
    return c.type === 'dm' && rIds.includes(targetUserId) && rIds.includes(req.user!.id);
  });

  if (existing) {
    const rIds = (existing as any).recipientIds || (existing as any).participantIds || [];
    const recipients = (await Promise.all(rIds.map(async (id: string) => {
      const u = await db.getUserById(id);
      if (!u) return null;
      const { passwordHash: _, ...safe } = u;
      return safe;
    }))).filter(Boolean);
    res.json({ conversation: { ...existing, recipients } });
    return;
  }

  const newConvo: DirectMessageConversation = {
    id: `dm_${uuidv4()}`,
    type: 'dm',
    recipientIds: [req.user.id, targetUserId],
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  await db.addConversation(newConvo);

  const recipients = (await Promise.all([req.user.id, targetUserId].map(async id => {
    const u = await db.getUserById(id);
    if (!u) return null;
    const { passwordHash: _, ...safe } = u;
    return safe;
  }))).filter(Boolean);

  res.status(201).json({ conversation: { ...newConvo, recipients } });
};

export const createGroupDM = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }

  const { name, recipientIds } = req.body;
  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    res.status(400).json({ error: 'Recipient IDs must be a non-empty array.' }); return;
  }

  const allRecipients = Array.from(new Set([req.user.id, ...recipientIds]));

  const newConvo: DirectMessageConversation = {
    id: `group_dm_${uuidv4()}`,
    type: 'group_dm',
    name: name || `Group (${allRecipients.length})`,
    recipientIds: allRecipients,
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };

  await db.addConversation(newConvo);

  const recipients = (await Promise.all(allRecipients.map(async id => {
    const u = await db.getUserById(id);
    if (!u) return null;
    const { passwordHash: _, ...safe } = u;
    return safe;
  }))).filter(Boolean);

  res.status(201).json({ conversation: { ...newConvo, recipients } });
};

export const getChannelMessages = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }

  const { channelId } = req.params;
  const limit = parseInt(req.query.limit as string) || 100;

  // Verify access for DM/Group conversations
  if (channelId.startsWith('dm_') || channelId.startsWith('group_dm_')) {
    const convo = await db.getConversationById(channelId);
    const rIds = convo ? ((convo as any).recipientIds || (convo as any).participantIds || []) : [];
    if (!convo || !rIds.includes(req.user.id)) {
      res.status(403).json({ error: 'Access denied to this conversation.' }); return;
    }
  }

  const rawMessages = await db.getMessages(channelId, limit);
  const populated = await Promise.all(rawMessages.map(async m => {
    const author = await db.getUserById(m.authorId);
    let safeAuthor = undefined;
    if (author) { const { passwordHash: _, ...safe } = author; safeAuthor = safe; }
    return { ...m, author: safeAuthor };
  }));

  res.json({ messages: populated });
};
