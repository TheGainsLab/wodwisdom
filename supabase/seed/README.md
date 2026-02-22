# Movements seed

1. Save your competition exercise data to `competition-exercises.json` as an array of objects with `exercise_name` and `slug` (full objects with `workout_id`, `workout_name`, etc. are also fine).

2. Run the seed script:
   ```bash
   npm run seed:movements
   ```

3. Copy the SQL output and run it in the Supabase SQL Editor.
