-- Add missing movement: snatch_balance
INSERT INTO movements (canonical_name, display_name, modality, category, aliases, competition_count)
VALUES ('snatch_balance', 'Snatch Balance', 'W', 'Weightlifting', '["snatch balance"]', 0)
ON CONFLICT (canonical_name) DO NOTHING;

-- Remove singular/plural duplicates: keep singular canonical, delete plural
DELETE FROM movements WHERE canonical_name = 'ring_dips';
DELETE FROM movements WHERE canonical_name = 'box_jumps';
