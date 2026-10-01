// Rules for editing a candidate from the admin pages. Pure and client-safe, so the API and the tests share them.
import { z } from 'zod';
import { parseDob } from '@/lib/dob';

/**
 * Every field is optional; send only what changed. `dob` is the NEW date of birth (it becomes the new password);
 * an empty string means "keep the current one". `unlock` clears the login lock and the failed-attempt counter.
 */
export const updateCandidateSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long').optional(),
    email: z.string().trim().toLowerCase().email('Email is not valid').max(254, 'Email is too long').optional(),
    dob: z.string().trim().max(20).optional(),
    unlock: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dob) {
      const dob = parseDob(value.dob);
      if (!dob.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dob'], message: dob.reason });
    }
    const changes = value.name !== undefined || value.email !== undefined || Boolean(value.dob) || value.unlock === true;
    if (!changes) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nothing to change' });
  });

export type UpdateCandidateInput = z.infer<typeof updateCandidateSchema>;
