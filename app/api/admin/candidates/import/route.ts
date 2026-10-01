import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { importCandidates } from '@/lib/candidates';
import { MAX_IMPORT_FILE_BYTES } from '@/lib/candidate-file';
import { err, json, route } from '@/lib/http';
import { jobFieldsSchema } from '@/lib/pipeline';

// bcrypt hashing of up to 200 rows can take several seconds on serverless CPUs.
export const maxDuration = 60;

const newJobSchema = jobFieldsSchema.pick({ title: true, jdText: true, requiredSkills: true, tier: true });

const formSchema = z.object({
  jobId: z.string().optional(),
  newJob: z.string().optional(),
  dryRun: z.enum(['true', 'false']).default('false'),
});

export const POST = route(async (req) => {
  const admin = await requireAdmin();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw err.badRequest('Send the file as multipart form data with a "file" field', 'INVALID_FORM');
  }

  const fields = formSchema.parse({
    jobId: form.get('jobId') || undefined,
    newJob: form.get('newJob') || undefined,
    dryRun: form.get('dryRun') ?? 'false',
  });
  let newJob;
  if (fields.newJob) {
    let raw: unknown;
    try {
      raw = JSON.parse(fields.newJob);
    } catch {
      throw err.badRequest('The new job details could not be read.', 'INVALID_FORM');
    }
    newJob = newJobSchema.parse(raw);
  }
  const file = form.get('file');
  if (!(file instanceof File)) throw err.badRequest('Attach the candidate list in the "file" field', 'FILE_REQUIRED');
  if (file.size > MAX_IMPORT_FILE_BYTES) throw err.tooLarge(`The file must be smaller than ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB`);

  const result = await importCandidates({
    jobId: fields.jobId,
    newJob,
    file: Buffer.from(await file.arrayBuffer()),
    dryRun: fields.dryRun === 'true',
    adminId: admin.id,
  });
  return json(result, result.dryRun ? 200 : 201);
});
