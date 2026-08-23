import bcrypt from 'bcryptjs';
import { 
  User, 
  FriendRelation, 
  Server, 
  Channel, 
  Message, 
  DirectMessageConversation, 
  StickerPack 
} from '../types';
import { 
  generateIntegritySeal
} from '../security/encryption';
import { sanitizeObject } from '../security/sanitizer';
import { supabase } from './supabase';

/**
 * =====================================================================
 * AeroCord Database Layer — Supabase PostgreSQL Backend
 * =====================================================================
 * All data is stored in Supabase PostgreSQL.
 * The encryption layer (AES-256-GCM, HMAC-SHA512) is preserved at
 * the application level for sensitive fields (passwords, 2FA secrets).
 * =====================================================================
 */
class Database {
  // ========== USERS ==========

  async getUsers(): Promise<User[]> {
    const { data, error } = await supabase.from('users').select('*');
    if (error) { console.error('getUsers error:', error); return []; }
    return (data || []) as User[];
  }

  async getUserById(id: string): Promise<User | undefined> {
    const { data, error } = await supabase.from('users').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return data as User;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .ilike('email', email)
      .single();
    if (error || !data) return undefined;
    return data as User;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .ilike('username', username)
      .single();
    if (error || !data) return undefined;
    return data as User;
  }

  async addUser(user: User): Promise<void> {
    const cleanUser = sanitizeObject(user) as any;
    cleanUser._sig = generateIntegritySeal(cleanUser.id + ':' + cleanUser.email);
    const { error } = await supabase.from('users').insert(cleanUser);
    if (error) throw new Error('Failed to create user: ' + error.message);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const cleanUpdates = sanitizeObject(updates) as any;
    // Recalculate signature after update
    const existingUser = await this.getUserById(id);
    if (!existingUser) return undefined;
    const merged = { ...existingUser, ...cleanUpdates };
    cleanUpdates._sig = generateIntegritySeal(id + ':' + (cleanUpdates.email || existingUser.email));

    const { data, error } = await supabase
      .from('users')
      .update(cleanUpdates)
      .eq('id', id)
      .select()
      .single();
    if (error) { console.error('updateUser error:', error); return undefined; }
    return data as User;
  }

  async deleteUser(userId: string): Promise<void> {
    // Remove user from all server member lists first
    const servers = await this.getServers();
    for (const server of servers) {
      if (server.members.some(m => m.userId === userId)) {
        await this.updateServer(server.id, {
          members: server.members.filter(m => m.userId !== userId)
        });
      }
    }
    await supabase.from('friends').delete().or(`userId.eq.${userId},friendId.eq.${userId}`);
    await supabase.from('users').delete().eq('id', userId);
  }

  async resetDatabase(): Promise<void> {
    // Clear all data
    await supabase.from('messages').delete().neq('id', '');
    await supabase.from('conversations').delete().neq('id', '');
    await supabase.from('friends').delete().neq('id', '');
    await supabase.from('servers').delete().neq('id', '');
    await supabase.from('sticker_packs').delete().neq('id', '');
    await supabase.from('users').delete().neq('id', '');
    // Re-seed
    await this.seedInitialData();
  }

  async seedInitialData(): Promise<void> {
    const salt = bcrypt.genSaltSync(10);
    const defaultPasswordHash = bcrypt.hashSync('password123', salt);

    const alice: User = {
      id: 'user_alice',
      username: 'Alice',
      discriminator: '1337',
      email: 'alice@aerocord.app',
      passwordHash: defaultPasswordHash,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      bannerColor: '#5865F2',
      status: 'online',
      customStatus: '🚀 Exploring AeroCord',
      bio: 'Frontend enthusiast & AeroCord developer',
      createdAt: new Date().toISOString()
    };

    const bob: User = {
      id: 'user_bob',
      username: 'Bob',
      discriminator: '2048',
      email: 'bob@aerocord.app',
      passwordHash: defaultPasswordHash,
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
      bannerColor: '#23A55A',
      status: 'online',
      customStatus: '🎮 Playing Cyberpunk',
      bio: 'Hardcore gamer & voice chat master',
      createdAt: new Date().toISOString()
    };

    const charlie: User = {
      id: 'user_charlie',
      username: 'Charlie',
      discriminator: '4096',
      email: 'charlie@aerocord.app',
      passwordHash: defaultPasswordHash,
      avatar: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=150&auto=format&fit=crop&q=80',
      bannerColor: '#F23F43',
      status: 'idle',
      customStatus: '☕ AFK brewing coffee',
      bio: 'Sound designer & WebRTC streamer',
      createdAt: new Date().toISOString()
    };

    await this.addUser(alice);
    await this.addUser(bob);
    await this.addUser(charlie);

    const defaultServer: Server = {
      id: 'srv_main',
      name: 'Aero Headquarters',
      icon: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150&auto=format&fit=crop&q=80',
      banner: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1200&auto=format&fit=crop&q=80',
      description: 'The official AeroCord community server!',
      ownerId: alice.id,
      inviteCode: 'AERO-2026',
      roles: [
        { id: 'role_admin', name: 'Admin', color: '#FEE75C', hoist: true, position: 1, permissions: { administrator: true, manageChannels: true, manageServer: true, sendMessages: true, embedLinks: true, attachFiles: true, voiceConnect: true, voiceSpeak: true, kickMembers: true, manageMessages: true } },
        { id: 'role_member', name: 'Member', color: '#99AAB5', hoist: false, position: 2, permissions: { administrator: false, manageChannels: false, manageServer: false, sendMessages: true, embedLinks: true, attachFiles: true, voiceConnect: true, voiceSpeak: true, kickMembers: false, manageMessages: false } }
      ],
      categories: [
        { id: 'cat_text', serverId: 'srv_main', name: 'TEXT CHANNELS', position: 1 },
        { id: 'cat_voice', serverId: 'srv_main', name: 'VOICE CHANNELS', position: 2 }
      ],
      channels: [
        { id: 'chan_general', serverId: 'srv_main', categoryId: 'cat_text', name: 'general', type: 'text', topic: 'General chat for everyone.', position: 1, createdAt: new Date().toISOString() },
        { id: 'chan_announcements', serverId: 'srv_main', categoryId: 'cat_text', name: 'announcements', type: 'text', topic: 'Official updates.', position: 2, createdAt: new Date().toISOString() },
        { id: 'chan_dev', serverId: 'srv_main', categoryId: 'cat_text', name: 'dev-chat', type: 'text', topic: 'Discuss code, bugs, and UI design.', position: 3, createdAt: new Date().toISOString() },
        { id: 'chan_voice_lounge', serverId: 'srv_main', categoryId: 'cat_voice', name: 'Lounge Voice 🔊', type: 'voice', position: 4, userLimit: 25, createdAt: new Date().toISOString() },
        { id: 'chan_voice_gaming', serverId: 'srv_main', categoryId: 'cat_voice', name: 'Gaming Room 🎮', type: 'voice', position: 5, userLimit: 10, createdAt: new Date().toISOString() }
      ],
      members: [
        { userId: alice.id, serverId: 'srv_main', roleIds: ['role_admin'], joinedAt: new Date().toISOString() },
        { userId: bob.id, serverId: 'srv_main', roleIds: ['role_member'], joinedAt: new Date().toISOString() },
        { userId: charlie.id, serverId: 'srv_main', roleIds: ['role_member'], joinedAt: new Date().toISOString() }
      ],
      emojis: [],
      createdAt: new Date().toISOString()
    };

    await this.addServer(defaultServer);

    const welcomeMsg: Message = {
      id: 'msg_welcome_1',
      channelId: 'chan_general',
      authorId: alice.id,
      content: '👋 Welcome to **AeroCord**! Chat in real-time, send images, use custom stickers, and hop into voice channels! 🎉',
      attachments: [],
      embeds: [],
      reactions: [],
      isPinned: false,
      isEdited: false,
      createdAt: new Date().toISOString()
    };
    await this.addMessage(welcomeMsg);
    console.log('✅ Database seeded with initial data.');
  }

  // ========== FRIENDS ==========

  async getFriends(userId: string): Promise<FriendRelation[]> {
    const { data, error } = await supabase
      .from('friends')
      .select('*')
      .or(`userId.eq.${userId},friendId.eq.${userId}`);
    if (error) { console.error('getFriends error:', error); return []; }
    return (data || []) as FriendRelation[];
  }

  async addFriendRelation(rel: FriendRelation): Promise<void> {
    const { error } = await supabase.from('friends').insert(rel);
    if (error) throw new Error('Failed to add friend relation: ' + error.message);
  }

  async updateFriendRelation(id: string, status: 'accepted' | 'blocked'): Promise<void> {
    const { error } = await supabase.from('friends').update({ status }).eq('id', id);
    if (error) throw new Error('Failed to update friend relation: ' + error.message);
  }

  async removeFriendRelation(userId: string, friendId: string): Promise<void> {
    await supabase
      .from('friends')
      .delete()
      .or(
        `and(userId.eq.${userId},friendId.eq.${friendId}),and(userId.eq.${friendId},friendId.eq.${userId})`
      );
  }

  // ========== SERVERS ==========

  async getServers(): Promise<Server[]> {
    const { data, error } = await supabase.from('servers').select('*');
    if (error) { console.error('getServers error:', error); return []; }
    return (data || []) as Server[];
  }

  async getServerById(id: string): Promise<Server | undefined> {
    const { data, error } = await supabase.from('servers').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return data as Server;
  }

  async getServerByInvite(code: string): Promise<Server | undefined> {
    const { data, error } = await supabase
      .from('servers')
      .select('*')
      .ilike('inviteCode', code)
      .single();
    if (error || !data) return undefined;
    return data as Server;
  }

  async addServer(server: Server): Promise<void> {
    const { error } = await supabase.from('servers').insert(server);
    if (error) throw new Error('Failed to create server: ' + error.message);
  }

  async updateServer(id: string, updates: Partial<Server>): Promise<Server | undefined> {
    const { data, error } = await supabase
      .from('servers')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) { console.error('updateServer error:', error); return undefined; }
    return data as Server;
  }

  async deleteServer(id: string): Promise<void> {
    const server = await this.getServerById(id);
    if (server) {
      const channelIds = server.channels.map(c => c.id);
      if (channelIds.length > 0) {
        await supabase.from('messages').delete().in('channelId', channelIds);
      }
    }
    await supabase.from('servers').delete().eq('id', id);
  }

  // ========== CHANNELS (stored in server JSONB array) ==========

  async getChannelById(channelId: string): Promise<Channel | undefined> {
    const servers = await this.getServers();
    for (const s of servers) {
      const ch = (s.channels || []).find(c => c.id === channelId);
      if (ch) return ch;
    }
    return undefined;
  }

  async addChannel(serverId: string, channel: Channel): Promise<Channel | undefined> {
    const server = await this.getServerById(serverId);
    if (!server) return undefined;
    const updatedChannels = [...(server.channels || []), channel];
    await this.updateServer(serverId, { channels: updatedChannels });
    return channel;
  }

  async deleteChannel(serverId: string, channelId: string): Promise<boolean> {
    const server = await this.getServerById(serverId);
    if (!server) return false;
    const updatedChannels = (server.channels || []).filter(c => c.id !== channelId);
    await this.updateServer(serverId, { channels: updatedChannels });
    await supabase.from('messages').delete().eq('channelId', channelId);
    return true;
  }

  // ========== MESSAGES ==========

  async getMessages(channelId: string, limit = 100): Promise<Message[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('channelId', channelId)
      .order('createdAt', { ascending: true })
      .limit(limit);
    if (error) { console.error('getMessages error:', error); return []; }
    return (data || []) as Message[];
  }

  async getMessageById(id: string): Promise<Message | undefined> {
    const { data, error } = await supabase.from('messages').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return data as Message;
  }

  async addMessage(msg: Message): Promise<Message> {
    const { data, error } = await supabase.from('messages').insert(msg).select().single();
    if (error) throw new Error('Failed to add message: ' + error.message);
    return (data as Message) || msg;
  }

  async updateMessage(id: string, updates: Partial<Message>): Promise<Message | undefined> {
    const { data, error } = await supabase
      .from('messages')
      .update({ ...updates, editedAt: new Date().toISOString(), isEdited: true })
      .eq('id', id)
      .select()
      .single();
    if (error) { console.error('updateMessage error:', error); return undefined; }
    return data as Message;
  }

  async deleteMessage(id: string): Promise<boolean> {
    const { error } = await supabase.from('messages').delete().eq('id', id);
    return !error;
  }

  // ========== CONVERSATIONS (Direct Messages) ==========

  async getConversations(userId: string): Promise<DirectMessageConversation[]> {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .contains('participantIds', [userId]);
    if (error) { console.error('getConversations error:', error); return []; }
    return (data || []) as DirectMessageConversation[];
  }

  async getConversationById(id: string): Promise<DirectMessageConversation | undefined> {
    const { data, error } = await supabase.from('conversations').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return data as DirectMessageConversation;
  }

  async addConversation(conv: DirectMessageConversation): Promise<DirectMessageConversation> {
    const convData = {
      ...conv,
      participantIds: (conv as any).recipientIds || (conv as any).participantIds || []
    };
    const { data, error } = await supabase.from('conversations').insert(convData).select().single();
    if (error) throw new Error('Failed to add conversation: ' + error.message);
    return (data as DirectMessageConversation) || conv;
  }

  async updateConversation(id: string, updates: Partial<DirectMessageConversation>): Promise<void> {
    await supabase
      .from('conversations')
      .update({ ...updates, updatedAt: new Date().toISOString() })
      .eq('id', id);
  }

  // ========== STICKER PACKS ==========

  async getStickerPacks(): Promise<StickerPack[]> {
    const { data, error } = await supabase.from('sticker_packs').select('*');
    if (error) { console.error('getStickerPacks error:', error); return []; }
    return (data || []) as StickerPack[];
  }

  async addCustomSticker(packId: string, sticker: { id: string; name: string; url: string; packId: string }): Promise<void> {
    const { data: existingPack } = await supabase
      .from('sticker_packs')
      .select('*')
      .eq('id', packId)
      .single();

    if (existingPack) {
      const updatedStickers = [...(existingPack.stickers || []), sticker];
      await supabase.from('sticker_packs').update({ stickers: updatedStickers }).eq('id', packId);
    } else {
      await supabase.from('sticker_packs').insert({
        id: packId,
        name: 'Custom Stickers',
        description: 'Server custom stickers',
        authorId: 'system',
        stickers: [sticker],
        isDefault: false
      });
    }
  }
}

export const db = new Database();
