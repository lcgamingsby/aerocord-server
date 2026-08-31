export type UserStatus = 'online' | 'idle' | 'dnd' | 'offline';

export interface User {
  id: string;
  username: string;
  discriminator: string;
  email: string;
  passwordHash: string;
  avatar: string;
  banner?: string;
  bannerColor?: string;
  customStatus?: string;
  status: UserStatus;
  bio?: string;
  isGuest?: boolean;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  twoFactorType?: 'google' | 'file' | 'email';
  twoFactorSecret?: string;
  twoFactorKeyId?: string;
  twoFactorKeyToken?: string;
  failedLoginAttempts?: number;
  lockedUntil?: number;
  _sig?: string;
  createdAt: string;
}

export interface FriendRelation {
  id: string;
  userId: string;
  friendId: string;
  status: 'pending' | 'accepted' | 'blocked';
  createdAt: string;
}

export interface Role {
  id: string;
  name: string;
  color: string;
  hoist: boolean; // display separately in sidebar
  position: number;
  permissions: {
    administrator: boolean;
    manageChannels: boolean;
    manageServer: boolean;
    sendMessages: boolean;
    embedLinks: boolean;
    attachFiles: boolean;
    voiceConnect: boolean;
    voiceSpeak: boolean;
    kickMembers: boolean;
    manageMessages: boolean;
  };
}

export interface ServerMember {
  userId: string;
  serverId: string;
  nickname?: string;
  roleIds: string[];
  joinedAt: string;
}

export interface Channel {
  id: string;
  serverId?: string; // undefined if DM
  categoryId?: string;
  name: string;
  type: 'text' | 'voice' | 'dm' | 'group_dm';
  topic?: string;
  position: number;
  userLimit?: number; // for voice
  createdAt: string;
}

export interface ChannelCategory {
  id: string;
  serverId: string;
  name: string;
  position: number;
}

export interface Server {
  id: string;
  name: string;
  icon?: string;
  banner?: string;
  description?: string;
  ownerId: string;
  inviteCode: string;
  roles: Role[];
  categories: ChannelCategory[];
  channels: Channel[];
  members: ServerMember[];
  emojis?: any[];
  createdAt: string;
}

export interface Reaction {
  emoji: string;
  users: string[]; // user IDs who reacted
}

export interface Attachment {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  size: number;
  width?: number;
  height?: number;
}

export interface PollOption {
  id: string;
  text: string;
  votes: string[]; // User IDs who voted for this option
}

export interface Poll {
  id: string;
  question: string;
  options: PollOption[];
  isMultiChoice?: boolean;
  allowMultipleVotes?: boolean;
  expiresAt?: string;
  closed?: boolean;
}

export interface LinkPreviewData {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon?: string;
  youtubeId?: string;
}

export interface Message {
  id: string;
  channelId: string;
  authorId: string;
  author?: Omit<User, 'passwordHash'>;
  content: string;
  attachments: Attachment[];
  embeds?: any[];
  stickerUrl?: string;
  replyToId?: string;
  replyToMessage?: Partial<Message>;
  reactions: Reaction[];
  poll?: Poll;
  linkPreviews?: LinkPreviewData[];
  isPinned: boolean;
  isEdited: boolean;
  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
}

export interface DirectMessageConversation {
  id: string;
  type: 'dm' | 'group_dm';
  name?: string;
  icon?: string;
  recipientIds: string[];
  lastMessageAt?: string;
  createdAt: string;
}

export interface StickerPack {
  id: string;
  name: string;
  description: string;
  stickers: {
    id: string;
    name: string;
    url: string;
    packId: string;
  }[];
}
