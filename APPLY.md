# Edit options for candidates and jobs (+ round order Assessment → Coding → Technical → HR)

This zip holds only the changed files, at their real project paths. It includes everything from the earlier zips, so you only need this one.

1. Stop the dev server (Ctrl+C). Keep a copy of your project folder first (several pages are replaced).
2. Unzip into your project folder (`interview-platform`), choosing **Replace** when asked.
3. In PowerShell, in the project folder:

```
npx prisma migrate deploy
npm test
Remove-Item -Recurse -Force .next
npm run dev -- -p 3001
```

No `npm install`, no `.env` change. `migrate deploy` will say "No pending migrations" if you already applied the round-order migration; that is fine.

## What to check

- **Admin → Jobs**: each row has **Edit**, which opens a dialog (title, description, skills, level, final result, retakes). The job page has an **Edit job** button too.
- On a job where a candidate has started, the description, skills, level and result mode are greyed out, and the dialog offers **Clone job and edit the copy**.
- **Admin → Candidates**: each row has **Edit** (name, email, new date of birth, unlock login), also on the candidate page.

## Files

Changed: `lib/jobs.ts` (the job list now includes the description, skills, retake policy and a "started" flag), `lib/candidates.ts`, `lib/pipeline.ts`, `components/JobForm.tsx` (unique field ids, optional Cancel and on-saved), `app/api/admin/candidates/[id]/route.ts`, `app/admin/(protected)/candidates/page.tsx`, `app/admin/(protected)/candidates/[id]/page.tsx`, `app/admin/(protected)/jobs/page.tsx`, `app/admin/(protected)/jobs/[id]/page.tsx`, `tests/pipeline.test.ts`, `README.md`.
New: `components/JobEditButton.tsx`, `components/CandidateEditButton.tsx`, `lib/candidate-edit.ts`, `tests/candidate-edit.test.ts`, `prisma/migrations/20261001180000_coding_before_technical/migration.sql`, `clear-attempts.js`.
