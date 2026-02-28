-- Simplify roles to user and admin only
-- Convert any coach/owner roles to user
UPDATE profiles SET role = 'user' WHERE role IN ('coach', 'owner');

-- Update constraint
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('user', 'admin'));
