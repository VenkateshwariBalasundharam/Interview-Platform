# Background sweep

This zip holds only the new and changed files, at their real project paths. It also contains the README and package.json from the earlier face-checks zip, so it includes everything from that one too. Keep a copy of your project folder first.

1. Stop the dev server (Ctrl+C).
2. Unzip into your project folder, choosing **Replace** when asked.
3. Add a secret to `.env` (16+ characters):

```
CRON_SECRET="paste-a-long-random-value-here"
```

4. In PowerShell, in the project folder:

```
npx prisma migrate deploy
npx prisma generate
npm test
Remove-Item -Recurse -Force .next
npm run dev -- -p 3001
```

5. In a second PowerShell window, keep the sweep running while you test:

```
npm run sweep:watch
```

6. Open Admin -> Dashboard: the new banner at the top shows the last run. Press **Run now** to test.

For a real deployment pick a scheduler (README, "Background sweep" -> Setup). Then follow the manual checklist at the end of that section.
