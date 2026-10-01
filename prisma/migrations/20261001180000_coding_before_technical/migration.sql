-- Run order is now Assessment -> Coding -> Technical -> HR.
-- For every existing job that has both a TECHNICAL and a CODING round sitting next to each other
-- (TECHNICAL immediately before CODING), swap their positions. Jobs with a different layout
-- (for example the Senior preset) are left untouched.
-- The unique index on ("jobId", "position") forbids a direct swap, so go through a temporary position.

UPDATE "RoundConfig" t
SET "position" = 1000
FROM "RoundConfig" c
WHERE t."jobId" = c."jobId"
  AND t."roundType" = 'TECHNICAL'
  AND c."roundType" = 'CODING'
  AND c."position" = t."position" + 1;

UPDATE "RoundConfig" c
SET "position" = c."position" - 1
FROM "RoundConfig" t
WHERE t."jobId" = c."jobId"
  AND t."roundType" = 'TECHNICAL'
  AND t."position" = 1000
  AND c."roundType" = 'CODING';

UPDATE "RoundConfig" t
SET "position" = (
  SELECT c."position" + 1 FROM "RoundConfig" c
  WHERE c."jobId" = t."jobId" AND c."roundType" = 'CODING'
)
WHERE t."roundType" = 'TECHNICAL' AND t."position" = 1000;
