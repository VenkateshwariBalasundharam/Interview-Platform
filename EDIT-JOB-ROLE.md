## Admin: change a candidate's job role

Use this when a candidate was registered under the wrong job.

**Where:** Admin > Candidates, the **Edit** button on the candidate's row, or **Edit candidate** on the candidate's page. The dialog now has a **Job role** field (type to search, pick from the list) next to name and email.
**Endpoint:** `PATCH /api/admin/candidates/:id` with `{ "jobId": "<job id>" }` (it can be combined with name, email, dob, unlock).

**Rules**
- Only before the candidate has started any round. Once they have an attempt the field is greyed out, and the API answers `409 JOB_LOCKED` (reset their rounds first, or delete and re-register them).
- If the new job already has a candidate with the same email you get `409 EMAIL_TAKEN`.
- Unknown job: `404 JOB_NOT_FOUND`. Picking the job they already have changes nothing.

**What changes:** the candidate moves to the new job and so follows its rounds, cutoffs and question sets. Their personalised question sets and job-fit summary (both written for the old job) are deleted, and are generated again for the new job. The Candidate ID, login, resume and date of birth stay the same.
**Audit log:** `CANDIDATE_UPDATED` with `fields` including `job`, plus `fromJobId` and `toJobId`.

**No migration, no `.env` change, no new package.**

### Manual checklist
1. Register a test candidate under the wrong job. Open Edit: Job role shows the current job.
2. Pick the right job and save. The Job column / header shows the new job.
3. Log in as the candidate: the rounds listed are the new job's.
4. Start a round as the candidate, then open Edit as admin: Job role is greyed out with the explanation.
5. Try changing to a job that already has the same email: you see the "already registered" message.
