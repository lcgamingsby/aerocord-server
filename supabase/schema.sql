-- ============================================================
-- AeroCord Database Schema for Supabase PostgreSQL
-- Run this in: Supabase Dashboard > SQL Editor > New query
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ========== USERS ==========
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  discriminator TEXT DEFAULT '0000',
  email TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT,
  avatar TEXT DEFAULT '',
  banner TEXT DEFAULT '',
  "bannerColor" TEXT DEFAULT '#5865F2',
  status TEXT DEFAULT 'offline',
  "customStatus" TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  "isGuest" BOOLEAN DEFAULT FALSE,
  "twoFactorEnabled" BOOLEAN DEFAULT FALSE,
  "twoFactorType" TEXT,
  "twoFactorSecret" TEXT,
  "twoFactorKeyId" TEXT,
  _sig TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_username ON users(LOWER(username));

-- ========== FRIEND RELATIONS ==========
CREATE TABLE IF NOT EXISTS friends (
  id TEXT PRIMARY KEY DEFAULT ('fr_' || replace(uuid_generate_v4()::text, '-', '')),
  "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "friendId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  "isSender" BOOLEAN DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE("userId", "friendId")
);

CREATE INDEX IF NOT EXISTS idx_friends_userid ON friends("userId");
CREATE INDEX IF NOT EXISTS idx_friends_friendid ON friends("friendId");

-- ========== SERVERS ==========
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT DEFAULT '',
  banner TEXT DEFAULT '',
  description TEXT DEFAULT '',
  "ownerId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  "inviteCode" TEXT UNIQUE,
  roles JSONB DEFAULT '[]',
  categories JSONB DEFAULT '[]',
  channels JSONB DEFAULT '[]',
  members JSONB DEFAULT '[]',
  emojis JSONB DEFAULT '[]',
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servers_owner ON servers("ownerId");
CREATE INDEX IF NOT EXISTS idx_servers_invite ON servers("inviteCode");

-- ========== MESSAGES ==========
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  content TEXT DEFAULT '',
  attachments JSONB DEFAULT '[]',
  embeds JSONB DEFAULT '[]',
  reactions JSONB DEFAULT '[]',
  "isPinned" BOOLEAN DEFAULT FALSE,
  "isEdited" BOOLEAN DEFAULT FALSE,
  "replyToId" TEXT,
  "stickerPackId" TEXT,
  "stickerId" TEXT,
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "editedAt" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages("channelId");
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages("authorId");
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages("createdAt" DESC);

-- ========== DIRECT MESSAGE CONVERSATIONS ==========
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  "participantIds" JSONB NOT NULL DEFAULT '[]',
  messages JSONB DEFAULT '[]',
  "createdAt" TIMESTAMPTZ DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ DEFAULT NOW()
);

-- ========== STICKER PACKS ==========
CREATE TABLE IF NOT EXISTS sticker_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  "authorId" TEXT NOT NULL,
  stickers JSONB DEFAULT '[]',
  "isDefault" BOOLEAN DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (RLS) — DISABLED for server-side admin client
-- The backend uses the SERVICE_ROLE key which bypasses all RLS.
-- ============================================================
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE friends DISABLE ROW LEVEL SECURITY;
ALTER TABLE servers DISABLE ROW LEVEL SECURITY;
ALTER TABLE messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE sticker_packs DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Done! Run seed.sql next to populate initial data.
-- ============================================================
