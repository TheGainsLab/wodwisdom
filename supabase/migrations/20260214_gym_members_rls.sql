-- Enable RLS on gym_members (idempotent)
ALTER TABLE gym_members ENABLE ROW LEVEL SECURITY;

-- Gym owners: full access to their gym's member rows
CREATE POLICY "Gym owners can select members"
ON gym_members FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM gyms
    WHERE gyms.id = gym_members.gym_id
      AND gyms.owner_id = auth.uid()
  )
);

CREATE POLICY "Gym owners can insert members"
ON gym_members FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM gyms
    WHERE gyms.id = gym_members.gym_id
      AND gyms.owner_id = auth.uid()
  )
);

CREATE POLICY "Gym owners can update members"
ON gym_members FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM gyms
    WHERE gyms.id = gym_members.gym_id
      AND gyms.owner_id = auth.uid()
  )
);

-- Coaches: can view and update their own membership rows
CREATE POLICY "Members can view own rows"
ON gym_members FOR SELECT
USING (
  user_id = auth.uid()
  OR invited_email = auth.email()
);

CREATE POLICY "Members can update own rows"
ON gym_members FOR UPDATE
USING (
  user_id = auth.uid()
  OR invited_email = auth.email()
);
