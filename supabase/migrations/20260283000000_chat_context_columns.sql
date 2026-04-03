-- Add context columns to chat_messages for coaching conversations
-- context_type: 'workout' for coaching chat, null for regular chat
-- context_id: program_workout ID when context_type is 'workout'
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS context_type text;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS context_id uuid;

-- Index for looking up coaching messages by workout
CREATE INDEX IF NOT EXISTS idx_chat_messages_context ON chat_messages(context_type, context_id) WHERE context_type IS NOT NULL;
