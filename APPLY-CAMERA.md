# Camera optional per round

Adds a **Camera required** switch to each round in the pipeline editor (on by default).
When it is off and a candidate's camera does not work (blocked, none found, in use), they can click
**Continue without camera**. No face checks run for that round, and the admin's Proctoring timeline shows
"The candidate continued without a camera (reason)".

## Install (PowerShell, project folder)

1. Unzip over the project (same paths).
2. `npx prisma migrate deploy`   (adds the `cameraRequired` column and the `CAMERA_UNAVAILABLE` event type)
3. `npx prisma generate`          (stop `npm run dev` first if it complains about a locked file)
4. Remove-Item -Recurse -Force .next
5. `npm run dev`

## Use it

Admin > Jobs > open the job > pipeline editor > untick **Camera required** on the round > Save pipeline.
(Face monitoring must not be Off for the box to be active. The pipeline is locked once any candidate has
started a round; use Clone on the job to get an editable copy.)

Rounds you do not touch keep requiring the camera, exactly as before.

## Manual check

- Round with Camera required ON: no "Continue without camera" button appears, even if the camera is blocked.
- Round with it OFF and camera blocked: button appears on the round intro; Start round becomes available;
  the exam opens without asking again; the candidate's timeline shows the event.
- Round with it OFF and a working camera: nothing changes.

## Quick switch without SQL (for testing without a webcam)

Stop nothing; just run in the project folder:

    npx tsx --env-file=.env --tsconfig tsconfig.json scripts/set-camera.ts off      all rounds, all jobs
    npx tsx --env-file=.env --tsconfig tsconfig.json scripts/set-camera.ts on       put it back
    npx tsx --env-file=.env --tsconfig tsconfig.json scripts/set-camera.ts status   show the setting per round

Add `--job <jobId>` or `--round TECHNICAL` to narrow it. Then reload the round page.
