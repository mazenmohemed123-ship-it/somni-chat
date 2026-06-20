-- ============================================================
-- Somni Chat Engine — Supabase Schema
-- Run once on a fresh Supabase project.
-- All tables live in the `public` schema.
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── CONVERSATIONS ───────────────────────────────────────────

CREATE TYPE conversation_type AS ENUM ('direct', 'group', 'channel', 'support', 'ai');
CREATE TYPE conversation_status AS ENUM ('active', 'archived', 'deleted');

CREATE TABLE conversations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 conversation_type NOT NULL,
  title                TEXT,
  description          TEXT,
  avatar_url           TEXT,
  status               conversation_status NOT NULL DEFAULT 'active',
  metadata             JSONB NOT NULL DEFAULT '{}',
  created_by           TEXT NOT NULL,
  last_message_at      TIMESTAMPTZ,
  last_message_preview TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_last_message_at ON conversations (last_message_at DESC);
CREATE INDEX idx_conversations_created_by ON conversations (created_by);

-- ─── PARTICIPANTS ─────────────────────────────────────────────

CREATE TYPE participant_role AS ENUM ('owner', 'admin', 'member', 'guest', 'bot');
CREATE TYPE participant_status AS ENUM ('active', 'left', 'banned', 'invited');

CREATE TABLE participants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id               TEXT NOT NULL,
  role                  participant_role NOT NULL DEFAULT 'member',
  status                participant_status NOT NULL DEFAULT 'active',
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at          TIMESTAMPTZ,
  last_read_message_id  UUID,
  notifications_muted   BOOLEAN NOT NULL DEFAULT FALSE,
  metadata              JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX idx_participants_unique ON participants (conversation_id, user_id);
CREATE INDEX idx_participants_user_id ON participants (user_id);
CREATE INDEX idx_participants_conversation_id ON participants (conversation_id);

-- ─── MESSAGES ─────────────────────────────────────────────────

CREATE TYPE message_type AS ENUM ('text', 'attachment', 'system', 'reply', 'ai');
CREATE TYPE message_status AS ENUM ('pending', 'sent', 'delivered', 'failed');

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       TEXT NOT NULL,
  type            message_type NOT NULL DEFAULT 'text',
  content         TEXT NOT NULL,
  status          message_status NOT NULL DEFAULT 'sent',
  client_id       UUID NOT NULL,
  reply_to_id     UUID REFERENCES messages(id) ON DELETE SET NULL,
  reply_to_preview TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  edited_at       TIMESTAMPTZ,
  deleted_at      TIMESTAMPTZ,
  metadata        JSONB NOT NULL DEFAULT '{}'
);

-- Prevent duplicate client_id per conversation (deduplication)
CREATE UNIQUE INDEX idx_messages_client_id ON messages (conversation_id, client_id);
CREATE INDEX idx_messages_conversation_created ON messages (conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages (sender_id);

-- Auto-update conversation.last_message_at
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations
  SET
    last_message_at = NEW.created_at,
    last_message_preview = LEFT(NEW.content, 100),
    updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_conversation_last_message
AFTER INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_last_message();

-- ─── ATTACHMENTS ──────────────────────────────────────────────

CREATE TYPE attachment_file_type AS ENUM ('image', 'video', 'audio', 'document', 'other');

CREATE TABLE attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id       UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_url         TEXT NOT NULL,
  file_name        TEXT NOT NULL,
  file_type        attachment_file_type NOT NULL DEFAULT 'other',
  mime_type        TEXT NOT NULL,
  file_size        BIGINT NOT NULL,
  thumbnail_url    TEXT,
  width            INTEGER,
  height           INTEGER,
  duration_seconds NUMERIC,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attachments_message_id ON attachments (message_id);

-- ─── REACTIONS ────────────────────────────────────────────────

CREATE TABLE reactions (
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  emoji       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- ─── PRESENCE ─────────────────────────────────────────────────

CREATE TYPE presence_status AS ENUM ('online', 'away', 'busy', 'offline');

CREATE TABLE user_presence (
  user_id      TEXT PRIMARY KEY,
  status       presence_status NOT NULL DEFAULT 'offline',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  device       TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'
);

-- ─── TYPING INDICATORS ────────────────────────────────────────
-- Ephemeral — rows are auto-deleted after 10 seconds via pg_cron or app logic.
-- For low-latency, use Supabase Realtime broadcast channels instead.

CREATE TABLE typing_indicators (
  conversation_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE typing_indicators ENABLE ROW LEVEL SECURITY;

-- Participants can see conversations they belong to
CREATE POLICY "participants_see_their_conversations"
ON conversations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM participants
    WHERE participants.conversation_id = conversations.id
    AND participants.user_id = auth.uid()::TEXT
    AND participants.status = 'active'
  )
);

-- Users can see messages in conversations they participate in
CREATE POLICY "participants_see_messages"
ON messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM participants
    WHERE participants.conversation_id = messages.conversation_id
    AND participants.user_id = auth.uid()::TEXT
    AND participants.status = 'active'
  )
);

-- Users can only insert their own messages
CREATE POLICY "users_send_messages"
ON messages FOR INSERT
WITH CHECK (sender_id = auth.uid()::TEXT);

-- Users can only update their own messages
CREATE POLICY "users_edit_own_messages"
ON messages FOR UPDATE
USING (sender_id = auth.uid()::TEXT);

-- Anyone can see presence
CREATE POLICY "anyone_sees_presence"
ON user_presence FOR SELECT USING (true);

-- Users update their own presence
CREATE POLICY "users_update_own_presence"
ON user_presence FOR ALL
USING (user_id = auth.uid()::TEXT);

-- ─── REALTIME PUBLICATIONS ────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE participants;
ALTER PUBLICATION supabase_realtime ADD TABLE user_presence;
ALTER PUBLICATION supabase_realtime ADD TABLE reactions;
