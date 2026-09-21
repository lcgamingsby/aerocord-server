-- =====================================================================
-- AeroCord PostgreSQL Database Indexing Script for Supabase / PostgreSQL
-- Run this in your Supabase SQL Editor to maximize query speeds and reduce database load.
-- =====================================================================

-- 1. Index for Messages: High performance fetching by channel sorted by creation date
CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages ("channelId", "createdAt" DESC);

-- 2. Index for Messages: Fast lookup by sender
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages ("senderId");

-- 3. Indexes for Users: Instant login and availability checks
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER("email"));
CREATE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER("username"));

-- 4. Indexes for Friends: Fast bilateral relationship queries
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends ("userId");
CREATE INDEX IF NOT EXISTS idx_friends_friend_id ON friends ("friendId");
CREATE INDEX IF NOT EXISTS idx_friends_status ON friends ("status");

-- 5. Index for Servers: Fast invite code lookups & owner queries
CREATE INDEX IF NOT EXISTS idx_servers_invite_code ON servers ("inviteCode");
CREATE INDEX IF NOT EXISTS idx_servers_owner_id ON servers ("ownerId");

-- 6. Index for Conversations: Fast user conversations retrieval
CREATE INDEX IF NOT EXISTS idx_conversations_id ON conversations ("id");
