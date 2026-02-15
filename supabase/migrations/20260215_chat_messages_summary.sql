-- Add summary column to chat_messages for one-time summarize feature
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS summary text;
