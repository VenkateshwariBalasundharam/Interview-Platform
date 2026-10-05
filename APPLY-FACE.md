# Browser-side face checks

This zip holds only the new and changed files, at their real project paths. Keep a copy of your project folder first.

1. Stop the dev server (Ctrl+C).
2. Unzip into your project folder, choosing **Replace** when asked.
3. In PowerShell, in the project folder:

```
npm install
npm test
Remove-Item -Recurse -Force .next
npm run dev -- -p 3001
```

No migration. Make sure `FACE_ENCRYPTION_KEY` is in `.env` (see README, "Face checks (server side)"), otherwise Identity rounds run as Presence only.

Then follow the manual checklist at the end of README.md under "Browser-side face checks". Test with a real webcam; candidates must be on https (or localhost).
