import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/database';
import { AuthenticatedRequest } from '../middleware/auth';
import { Server, Channel, Role } from '../types';

export const getServers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const allServers = await db.getServers();
  const userServers = allServers.filter(s => s.members.some(m => m.userId === req.user!.id));
  res.json({ servers: userServers });
};

export const getServerDetails = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { serverId } = req.params;
  const server = await db.getServerById(serverId);
  if (!server) { res.status(404).json({ error: 'Server not found.' }); return; }
  const isMember = server.members.some(m => m.userId === req.user!.id);
  if (!isMember) { res.status(403).json({ error: 'You are not a member of this server.' }); return; }
  const populatedMembers = await Promise.all(server.members.map(async m => {
    const user = await db.getUserById(m.userId);
    let safeUser = undefined;
    if (user) { const { passwordHash: _, ...safe } = user; safeUser = safe; }
    return { ...m, user: safeUser };
  }));
  res.json({ server: { ...server, members: populatedMembers.filter(m => m.user !== undefined) } });
};

export const createServer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  if (req.user.isGuest || req.user.id.startsWith('guest_') || req.user.email.endsWith('@guest.aerocord.app')) {
    res.status(403).json({ error: 'Akun tamu tidak dapat membuat server baru. Silakan tingkatkan akun Anda ke akun permanen terlebih dahulu.' }); return;
  }
  const { name, icon, description } = req.body;
  if (!name || name.trim().length === 0) { res.status(400).json({ error: 'Nama server wajib diisi.' }); return; }

  const serverId = `srv_${uuidv4()}`;
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  const ownerRole: Role = { id: `role_owner_${uuidv4()}`, name: 'Owner', color: '#FEE75C', hoist: true, position: 1, permissions: { administrator: true, manageChannels: true, manageServer: true, sendMessages: true, embedLinks: true, attachFiles: true, voiceConnect: true, voiceSpeak: true, kickMembers: true, manageMessages: true } };
  const memberRole: Role = { id: `role_member_${uuidv4()}`, name: 'Member', color: '#5865F2', hoist: false, position: 2, permissions: { administrator: false, manageChannels: false, manageServer: false, sendMessages: true, embedLinks: true, attachFiles: true, voiceConnect: true, voiceSpeak: true, kickMembers: false, manageMessages: false } };
  const catTextId = `cat_text_${uuidv4()}`;
  const catVoiceId = `cat_voice_${uuidv4()}`;
  const defaultChannels: Channel[] = [
    { id: `chan_gen_${uuidv4()}`, serverId, categoryId: catTextId, name: 'general', type: 'text', topic: 'General discussions.', position: 1, createdAt: new Date().toISOString() },
    { id: `chan_vc_${uuidv4()}`, serverId, categoryId: catVoiceId, name: 'General Voice 🔊', type: 'voice', position: 2, userLimit: 20, createdAt: new Date().toISOString() }
  ];
  const defaultIcons = [
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=150&auto=format&fit=crop&q=80'
  ];
  const newServer: Server = {
    id: serverId, name: name.trim(),
    icon: icon || defaultIcons[Math.floor(Math.random() * defaultIcons.length)],
    description: description || '', ownerId: req.user.id, inviteCode,
    roles: [ownerRole, memberRole],
    categories: [{ id: catTextId, serverId, name: 'TEXT CHANNELS', position: 1 }, { id: catVoiceId, serverId, name: 'VOICE CHANNELS', position: 2 }],
    channels: defaultChannels,
    members: [{ userId: req.user.id, serverId, roleIds: [ownerRole.id], joinedAt: new Date().toISOString() }],
    emojis: [], createdAt: new Date().toISOString()
  };
  await db.addServer(newServer);
  res.status(201).json({ server: newServer });
};

export const joinServerByInvite = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { inviteCode } = req.body;
  if (!inviteCode) { res.status(400).json({ error: 'Invite code is required.' }); return; }
  const server = await db.getServerByInvite(inviteCode.trim());
  if (!server) { res.status(404).json({ error: 'Invalid invite code or server does not exist.' }); return; }
  const alreadyMember = server.members.some(m => m.userId === req.user!.id);
  if (alreadyMember) { res.json({ server, message: 'You are already a member of this server.' }); return; }
  const memberRole = server.roles.find(r => r.name === 'Member') || server.roles[server.roles.length - 1];
  const updatedMembers = [...server.members, { userId: req.user.id, serverId: server.id, roleIds: memberRole ? [memberRole.id] : [], joinedAt: new Date().toISOString() }];
  await db.updateServer(server.id, { members: updatedMembers });
  res.json({ server: { ...server, members: updatedMembers }, message: `Successfully joined ${server.name}!` });
};

export const createChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { serverId } = req.params;
  const { name, type, categoryId, topic } = req.body;
  const server = await db.getServerById(serverId);
  if (!server) { res.status(404).json({ error: 'Server not found.' }); return; }
  const member = server.members.find(m => m.userId === req.user!.id);
  if (!member) { res.status(403).json({ error: 'You are not a member of this server.' }); return; }
  const userRoles = server.roles.filter(r => member.roleIds.includes(r.id));
  const canManage = server.ownerId === req.user.id || userRoles.some(r => r.permissions.administrator || r.permissions.manageChannels);
  if (!canManage) { res.status(403).json({ error: 'You do not have permission to create channels in this server.' }); return; }
  const formattedName = (name || 'new-channel').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
  const textCategory = server.categories.find(c => c.name.toLowerCase().includes('text')) || server.categories[0];
  const voiceCategory = server.categories.find(c => c.name.toLowerCase().includes('voice')) || server.categories[1] || server.categories[0];
  const targetCategoryId = categoryId && server.categories.some(c => c.id === categoryId) ? categoryId : (type === 'voice' ? voiceCategory?.id : textCategory?.id);
  const newChannel: Channel = { id: `chan_${uuidv4()}`, serverId, categoryId: targetCategoryId, name: type === 'voice' ? `${name}` : formattedName, type: type === 'voice' ? 'voice' : 'text', topic: topic || '', position: server.channels.length + 1, createdAt: new Date().toISOString() };
  await db.addChannel(serverId, newChannel);
  res.status(201).json({ channel: newChannel });
};

export const deleteChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { serverId, channelId } = req.params;
  const server = await db.getServerById(serverId);
  if (!server) { res.status(404).json({ error: 'Server not found.' }); return; }
  const member = server.members.find(m => m.userId === req.user!.id);
  if (!member) { res.status(403).json({ error: 'Access denied.' }); return; }
  const userRoles = server.roles.filter(r => member.roleIds.includes(r.id));
  const canManage = server.ownerId === req.user.id || userRoles.some(r => r.permissions.administrator || r.permissions.manageChannels);
  if (!canManage) { res.status(403).json({ error: 'Permission denied to delete channels.' }); return; }
  const success = await db.deleteChannel(serverId, channelId);
  if (!success) { res.status(404).json({ error: 'Channel not found.' }); return; }
  res.json({ message: 'Channel deleted successfully.' });
};

export const updateServer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { serverId } = req.params;
  const { name, icon, description, roles, members } = req.body;
  const server = await db.getServerById(serverId);
  if (!server) { res.status(404).json({ error: 'Server not found.' }); return; }
  if (server.ownerId !== req.user.id) { res.status(403).json({ error: 'Hanya server owner yang dapat mengubah pengaturan server.' }); return; }
  const updates: Partial<Server> = {};
  if (name && name.trim()) updates.name = name.trim();
  if (icon !== undefined) updates.icon = icon.trim() || undefined;
  if (description !== undefined) updates.description = description.trim();
  if (roles !== undefined) updates.roles = roles;
  if (members !== undefined) updates.members = members;
  const updated = await db.updateServer(serverId, updates);
  res.json({ server: updated || server, message: 'Pengaturan server berhasil diperbarui.' });
};

export const deleteServer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { serverId } = req.params;
  const server = await db.getServerById(serverId);
  if (!server) { res.status(404).json({ error: 'Server not found.' }); return; }
  if (server.ownerId !== req.user.id) { res.status(403).json({ error: 'Hanya server owner yang dapat menghapus server.' }); return; }
  await db.deleteServer(serverId);
  res.json({ message: 'Server berhasil dihapus.' });
};

export const updateChannel = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { serverId, channelId } = req.params;
  const { name, topic, categoryId } = req.body;
  const server = await db.getServerById(serverId);
  if (!server) { res.status(404).json({ error: 'Server not found.' }); return; }
  const channel = server.channels.find(c => c.id === channelId);
  if (!channel) { res.status(404).json({ error: 'Channel not found.' }); return; }
  if (name && name.trim()) channel.name = name.trim();
  if (topic !== undefined) channel.topic = topic.trim();
  if (categoryId) channel.categoryId = categoryId;
  await db.updateServer(serverId, { channels: server.channels });
  res.json({ channel, message: 'Channel berhasil diperbarui.' });
};

export const createCategory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  const { serverId } = req.params;
  const { name } = req.body;
  const server = await db.getServerById(serverId);
  if (!server) { res.status(404).json({ error: 'Server not found.' }); return; }
  const newCat = { id: `cat_${uuidv4().substring(0, 8)}`, name: name?.trim() || 'Group Channel Baru', serverId, position: server.categories.length + 1 };
  const updatedCategories = [...(server.categories || []), newCat];
  await db.updateServer(serverId, { categories: updatedCategories });
  res.status(201).json({ category: newCat, server: { ...server, categories: updatedCategories } });
};
