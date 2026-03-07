-- Seed initial strength guidelines into coaching_guidelines.

INSERT INTO coaching_guidelines (category, scope, guideline_text, priority) VALUES

-- Movement frequency & sequencing
('strength', 'all',
 'No single strength exercise more than 2x per week. Vary barbell movements across the week (e.g. back squat Mon, front squat Thu — not back squat Mon/Wed/Fri).',
 10),

('strength', 'all',
 'Do not program heavy squats and heavy deadlifts on consecutive days. Same for pressing patterns (strict press and push press should not be back-to-back days).',
 10),

-- Weakness / strength balance
('strength', 'all',
 'Weakness movements: program 2x per week across the cycle.',
 5),

('strength', 'all',
 'Strengths and maintenance movements: still program 1x per week. Do not ignore movements just because they are not a weakness.',
 5),

('strength', 'all',
 'Distribute weakness work across all 4 weeks with progression, not just repetition.',
 5),

-- Level A (developing) — barbell
('strength', 'beginner',
 'Level A (developing): Use simple barbell movements, conservative percentages (65-75% build weeks, 50-60% deload). No tempo variations or complexes. Prioritize movement quality cues.',
 8),

-- Level B (intermediate) — barbell
('strength', 'all',
 'Level B (intermediate): Standard programming (70-85% build range). Introduce some variations (pause reps, tempo). Moderate complexity.',
 8),

-- Level C (advanced) — barbell
('strength', 'competition',
 'Level C (advanced): Full programming toolbox (70-85% build range). Complexes, clusters, wave loading are fair game.',
 8),

-- Oly — Level A
('strength', 'beginner',
 'Oly Level A (developing): Higher reps at lower percentages. Emphasize full versions of lifts (full snatch, full clean). Focus on positions.',
 8),

-- Oly — Level B
('strength', 'all',
 'Oly Level B (proficient): Lower reps at higher percentages. Full or power versions. More advanced complexes.',
 8),

-- Per-lift independence
('strength', 'all',
 'Apply strength level guidelines independently per movement pattern — e.g. if Squat=B but Bench=A, squat work uses B guidelines while pressing uses A guidelines.',
 9);
