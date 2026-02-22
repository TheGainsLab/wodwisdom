# Movements seed

1. Save your competition exercise data to `competition-exercises.json` as an array of objects with `exercise_name` and `slug` (full objects with `workout_id`, `workout_name`, etc. are also fine).

2. Modality (W/G/M) is read from `movement-modalities.json`. Add new canonicals there when new movements appear in competition data. Keys starting with `_` are ignored. Valid values: `"W"` (Weightlifting), `"G"` (Gymnastics), `"M"` (Monostructural).

3. Run the seed script:
   ```bash
   npm run seed:movements
   ```

4. Copy the SQL output and run it in the Supabase SQL Editor.
