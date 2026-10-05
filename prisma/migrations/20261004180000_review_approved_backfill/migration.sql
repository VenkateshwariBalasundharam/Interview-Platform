-- Candidates an admin approved before reviewApprovedAt existed: take the date from the audit log.
-- Skipped when a round was reset afterwards (the approval was for results that no longer exist),
-- and only for candidates that are still ACTIVE or COMPLETED.
UPDATE "Candidate" c
SET "reviewApprovedAt" = a.approved_at
FROM (
  SELECT "entityId", MAX("createdAt") AS approved_at
  FROM "AuditLog"
  WHERE "action" = 'CANDIDATE_REVIEW_APPROVED' AND "entity" = 'Candidate'
  GROUP BY "entityId"
) a
WHERE c."id" = a."entityId"
  AND c."reviewApprovedAt" IS NULL
  AND c."status" IN ('ACTIVE', 'COMPLETED')
  AND NOT EXISTS (
    SELECT 1 FROM "AuditLog" r
    WHERE r."action" = 'ROUND_RESET' AND r."entity" = 'Candidate' AND r."entityId" = c."id" AND r."createdAt" > a.approved_at
  );
