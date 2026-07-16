-- Chat question insights: AI-classified labels for every chat question.
--
-- Chat questions are the richest untapped product dataset in the app — every
-- one is a user saying what they want, what confuses them, and what they'd
-- pay for. Nobody has time to read them manually. A nightly classifier
-- (classify-chat-questions edge function, Haiku) labels each question against
-- a deliberately BROAD taxonomy; insight then falls out of plain SQL:
-- topic trends, the feature-request feed, a review queue, churn signals.
--
-- Taxonomy discipline: labels are FIXED here as CHECK constraints. Broad
-- buckets age better — splitting a bucket later is trend-safe, renaming or
-- merging is not. 'other' is the classifier's escape hatch (forcing a wrong
-- bucket pollutes trends; 'other' growing is itself the signal that a new
-- category is needed). Nutrition/fueling lives under 'body' until its volume
-- justifies its own bucket.
--
--   topic:  engine | training | body | performance | product | other
--   intent: question | feature_request | complaint | praise
--   buying_intent:  user showing interest in paid plans/upgrades
--   review_worthy:  human should look — weak/hedgy answer, injury/medical
--                   territory, or visible frustration
--
-- One row per classified message; unclassified = no row yet (the nightly run
-- picks up whatever is missing, so a failed run self-heals the next night).

CREATE TABLE chat_question_insights (
  message_id uuid PRIMARY KEY REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  topic text NOT NULL CHECK (topic IN ('engine', 'training', 'body', 'performance', 'product', 'other')),
  intent text NOT NULL CHECK (intent IN ('question', 'feature_request', 'complaint', 'praise')),
  buying_intent boolean NOT NULL DEFAULT false,
  review_worthy boolean NOT NULL DEFAULT false,
  model text,
  classified_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cqi_topic ON chat_question_insights(topic);
CREATE INDEX idx_cqi_intent ON chat_question_insights(intent) WHERE intent <> 'question';
CREATE INDEX idx_cqi_user ON chat_question_insights(user_id);
CREATE INDEX idx_cqi_review ON chat_question_insights(review_worthy) WHERE review_worthy;
CREATE INDEX idx_cqi_buying ON chat_question_insights(buying_intent) WHERE buying_intent;

-- Writes are service-role only (the classifier function); admins can read
-- directly for dashboard queries. Same posture as email_sends.
ALTER TABLE chat_question_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY cqi_select_admin ON chat_question_insights
  FOR SELECT USING (public.is_current_user_admin());

COMMENT ON TABLE chat_question_insights IS
  'AI-assigned labels per chat question (classify-chat-questions, nightly). Topic taxonomy is deliberately broad and fixed; split buckets only when volume justifies — never rename/merge (resets trends).';
