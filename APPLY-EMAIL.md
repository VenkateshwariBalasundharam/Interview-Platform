# Email invites and notifications

This zip is your full project with the email feature added. Keep a copy of your project folder first.

1. Stop the dev server (Ctrl+C), unzip over your project folder and choose **Replace**.
2. Install the new package and apply the database change:

```
npm install
npx prisma migrate deploy
npx prisma generate
npm test
```

3. Add to `.env` (for a first test, no mail account is needed):

```
APP_URL="http://localhost:3100"
EMAIL_DRIVER="console"
```

   For real sending, replace the console line with your provider's `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `EMAIL_FROM` (see `.env.example`).

4. Start the app and the sweep (second window):

```
Remove-Item -Recurse -Force .next
npm run dev
npm run sweep:watch
```

5. Admin -> Candidates: import a file, then follow "Manual checklist" under *Candidate emails* in the README.
