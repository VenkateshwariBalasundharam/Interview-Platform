## Admin: reset one round for one candidate

Use this when a candidate could not finish a round for a reason that was not their fault (power cut, browser crash, a broken question) and should take it again.

**Where:** Admin > Candidates > open the candidate. The most recent round card has a **Reset <round> round** button. Enter a reason (required, at least 5 characters) and confirm.
**Endpoint:** `POST /api/admin/candidates/:id/rounds/:roundType/reset` with `{ "reason": "..." }` (admin only). Returns `{ roundType, roundLabel, status }`. Errors use the usual shape: `400` bad round or reason, `401`, `404` candidate/round not found or never started, `409` blocked (see below).

**What it deletes:** that candidate's attempt for the round (answers, scores, coding submissions), that attempt's proctoring events and snapshot images, the candidate's stored final result (any decision on it no longer applies) and their job-fit summary (generate a new one after they finish).
**What it keeps:** the candidate, their login, resume, every other round, and the question set. The retake starts with a fresh timer and a new question order.
**Audit log:** `ROUND_RESET` with who, why, the discarded attempt's status and percent, how many proctoring events were discarded, the status change and any discarded final decision. Never answers.

**Rules**
- Rounds run in order. If the candidate has started a later round, reset the later rounds first, newest first (`409 LATER_ROUNDS_STARTED`).
- A round still in progress can be reset; it ends immediately and the candidate's open page gets an error on the next save.
- The live Manager interview has no attempt. Change its score instead (`409 ROUND_NOT_RESETTABLE`).
- Candidate status: Completed goes back to Active. Disqualified or Pending review goes back to Active only if THIS round's score was below its cutoff; otherwise the status is left alone.
- The job's "Retakes" setting is not checked: this is an explicit admin action.

**No migration, no `.env` change, no new package.**

### Manual checklist
1. As a test candidate, finish Round 1 below its cutoff so they are disqualified. As admin, open them: the Assessment card shows Reset. Reset it with a reason.
2. The candidate is Active again. Log in as them: Round 1 is available with a full timer and a different question order.
3. Finish Round 1 and start Round 2. Back on the admin page, the Assessment card shows "reset the later rounds first" and the button is on Round 2 only. Try the API for Round 1: you get 409.
4. Reset Round 2 while it is in progress. The candidate's open page shows an error on the next autosave; they can start it again.
5. Open the audit log: `ROUND_RESET` rows with your reasons.
6. Reset a round for a candidate who already has a decision on the Results page: the result row is gone until they finish again.
