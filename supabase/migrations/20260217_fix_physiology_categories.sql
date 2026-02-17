-- Fix physiology textbook chunks that were ingested without --category science.
-- The normalization migration incorrectly set them to 'journal'.
--
-- Guyton chapters have titles starting with a chapter number (e.g.
-- "30 Regulation Of Acid Base Balance", "84 Sports Physiology").
-- CrossFit Journal articles don't follow this pattern.

-- Catch numbered Guyton chapters
UPDATE chunks
SET category = 'science'
WHERE category != 'science'
  AND title ~ '^\d{1,3}\s+[A-Z]';

-- Catch the full textbook if ingested as a single document
UPDATE chunks
SET category = 'science'
WHERE category != 'science'
  AND (
    title ILIKE '%Textbook of Medical Physiology%'
    OR title ILIKE '%Guyton%'
    OR source ILIKE '%Medical Physiology%'
    OR source ILIKE '%Guyton%'
  );
