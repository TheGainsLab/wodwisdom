# Movements seed

1. Save your competition exercise data to `competition-exercises.json` as an array of objects with `exercise_name` and `slug` (full objects with `workout_id`, `workout_name`, etc. are also fine).

2. Modality (W/G/M) is read from `movement-modalities.json`. Add new canonicals there when new movements appear in competition data. Keys starting with `_` are ignored. Valid values: `"W"` (Weightlifting), `"G"` (Gymnastics), `"M"` (Monostructural).

3. Run the seed script:
   ```bash
   npm run seed:movements
   ```

4. Copy the SQL output and run it in the Supabase SQL Editor.

# Engine test athlete

`engine_test_athlete.sql` builds a synthetic 3-day Engine subscriber who has
just completed the assessment month (positions 1–12 of `main_3day`, pointer at
the month-two time trial, sequencer on). Create the auth user first, set the
email at the top of the file, paste the whole file into the Supabase SQL editor
and run it once. Idempotent per user. Then: Admin → Users → the athlete →
Engine AI Preview for a dry run; the resequence cron generates the real block
within fifteen minutes.
