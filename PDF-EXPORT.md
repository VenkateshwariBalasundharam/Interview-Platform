## PDF export of results

Two PDF downloads, both admin-only, both built with a small writer in `lib/pdf-writer.ts` (no new npm package, no `.env` change, no migration).

| Where | Button | Endpoint | File |
| --- | --- | --- | --- |
| Admin > Results | Download PDF (next to Download CSV; respects the job filter) | `GET /api/admin/results/export-pdf?jobId=` (jobId optional) | `interview-results.pdf` |
| Admin > Candidate > Final result | Download PDF | `GET /api/admin/candidates/:id/result-pdf` | `result-<candidate id>.pdf` |

- The list PDF is a landscape table with the same rows as the CSV: each round's percent, weighted score, suggested decision, final decision (or "Pending") and proctoring count. A rejection that rests on AI-graded answers is marked `*` with a note.
- The candidate PDF is a one-page sheet: weighted score, round breakdown (weight, score, cutoff, result, points), the reasons, the admin's decision, and the human-review notice when it applies.
- It contains scores and identity fields only. It never contains the date of birth, answers, resume text, answer keys or hidden tests.
- Each export is written to the audit log (`RESULTS_EXPORTED` with `format: pdf`, or `RESULT_PDF_EXPORTED`).
- Names with characters outside Latin-1 (for example Tamil) print as `?`, because the built-in PDF fonts cannot draw them. The CSV export keeps the full text.
- Errors use the usual shape `{ error: { code, message } }`: 401 not logged in, 400 bad `jobId`, 404 unknown candidate or job.

### Manual checklist
1. Admin > Results: click Download PDF. Open it: heading "All jobs", one row per candidate, page numbers in the footer.
2. Pick a job in the filter, download again: the heading is the job title and only that job's candidates appear.
3. Open a candidate, click Download PDF in the Final result card: the numbers match the card.
4. A candidate whose rejection rests on an AI-graded round, not yet decided: the sheet shows the yellow human-review notice and "Pending human review". Confirm the decision, download again: the notice is gone.
5. Log out and open `/api/admin/results/export-pdf` directly: you get 401, not a file.
