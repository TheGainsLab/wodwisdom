-- Admin email sends: log every email the admin panel sends to a user via
-- the admin-send-email edge function. Powers the "Email" section on the
-- admin user detail page (history of sends + delivery status) and lays
-- the foundation for the upcoming bulk win-back campaigns (campaign_key
-- groups sends from a single bulk run).

CREATE TABLE email_sends (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'welcome_back', 'custom', etc. Identifies the template used. 'custom'
  -- means the admin typed the subject + body inline.
  template_key    text NOT NULL,
  -- Subject line as actually sent (rendered, not the raw template).
  subject         text NOT NULL,
  -- Optional grouping for bulk campaigns. Null for one-off admin sends.
  campaign_key    text,
  -- Resend's id for the message — used by future webhook handler to
  -- correlate delivery / open / click / bounce events back to a send.
  resend_message_id text,
  -- 'sent' immediately after the Resend call returns ok. Future statuses
  -- ('delivered', 'opened', 'clicked', 'bounced', 'failed') will be
  -- written by an email-webhook function in a follow-up PR.
  status          text NOT NULL DEFAULT 'sent',
  sent_at         timestamptz NOT NULL DEFAULT now(),
  last_event_at   timestamptz
);

CREATE INDEX idx_email_sends_user_id ON email_sends(user_id, sent_at DESC);
CREATE INDEX idx_email_sends_campaign_key ON email_sends(campaign_key) WHERE campaign_key IS NOT NULL;
CREATE INDEX idx_email_sends_resend_message_id ON email_sends(resend_message_id) WHERE resend_message_id IS NOT NULL;

ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;

-- Admins (profiles.role = 'admin') can read all rows so the admin user
-- detail page can fetch email history client-side without going through
-- a dedicated RPC. Inserts are service-role-only (admin-send-email
-- writes via the service-role client and bypasses RLS).
CREATE POLICY "admin select" ON email_sends
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
