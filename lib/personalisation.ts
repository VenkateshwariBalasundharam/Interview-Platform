// Rules for resume-personalised question sets. Pure and client-safe (no database, no model calls).
//
// Technical and HR rounds can have one question set per candidate, written from that candidate's parsed resume.
// Every other round, and any candidate without a usable resume, keeps using the job-wide set.
import type { GeneratedRound, SetStatus } from '@/lib/questions';

/** The parts of a parsed resume that questions are built from. A parsed resume satisfies this as is. */
export interface ResumeContext {
  experienceYears: number;
  skills: string[];
  projects: { name: string; summary: string; technologies: string[] }[];
}

export function toResumeContext(resume: ResumeContext): ResumeContext {
  return { experienceYears: resume.experienceYears, skills: resume.skills, projects: resume.projects };
}

export const PERSONALISED_ROUNDS = ['TECHNICAL', 'HR'] as const satisfies readonly GeneratedRound[];
export type PersonalisedRound = (typeof PERSONALISED_ROUNDS)[number];

export function isPersonalisedRound(roundType: string): roundType is PersonalisedRound {
  return (PERSONALISED_ROUNDS as readonly string[]).includes(roundType);
}

/** A resume is usable when the parser found something to build questions on: skills for Technical, projects for HR. */
export function resumeSupports(roundType: PersonalisedRound, resume: ResumeContext | null | undefined): boolean {
  if (!resume) return false;
  return roundType === 'TECHNICAL' ? resume.skills.length > 0 : resume.projects.length > 0;
}

/** Skill names compared loosely: "Node.js", "NodeJS" and "node js" match, while C, C++ and C# stay different. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, '');

/**
 * What each batch of Technical questions should focus on: the resume skills the job also asks for come first
 * (they are what the role needs and the candidate claims), then the other resume skills. With no overlap the
 * resume skills alone are used. HR focuses on the candidate's projects.
 */
export function personalisedFocus(roundType: PersonalisedRound, resume: ResumeContext, requiredSkills: string[]): string[] {
  if (roundType === 'HR') return resume.projects.map((p) => p.name);
  const required = new Set(requiredSkills.map(norm));
  const overlap = resume.skills.filter((s) => required.has(norm(s)));
  const rest = resume.skills.filter((s) => !required.has(norm(s)));
  const ordered = [...overlap, ...rest];
  return ordered.length > 0 ? ordered : requiredSkills;
}

/** Round-specific instructions added when a candidate's resume is part of the prompt. */
export const PERSONALISED_GUIDE: Record<PersonalisedRound, string> = {
  TECHNICAL:
    'These questions are for ONE candidate. Base most of them on skills listed in their resume, giving priority to skills the job also requires. Where a resume project uses a skill, you may ask how it works in that kind of project. Do not ask about tools that appear in neither the resume nor the required skills. Keep the difficulty suited to their years of experience.',
  HR: 'These questions are for ONE candidate. Ask about the projects in their resume: refer to a project by its name, and ask about their own role, a decision they made, a problem they hit, what they learned, or how they worked with others. Tie at least some questions to responsibilities in the job description. Do not invent details that are not in the resume.',
};

// ───────────────────────── Status roll-up for the admin panel ─────────────────────────

export type CandidateSetState = 'NO_RESUME' | 'NOT_GENERATED' | SetStatus;

export interface SetCounts {
  total: number;
  noResume: number;
  notGenerated: number;
  draft: number;
  approved: number;
  locked: number;
}

export function countStates(states: CandidateSetState[]): SetCounts {
  const counts: SetCounts = { total: states.length, noResume: 0, notGenerated: 0, draft: 0, approved: 0, locked: 0 };
  for (const s of states) {
    if (s === 'NO_RESUME') counts.noResume++;
    else if (s === 'NOT_GENERATED') counts.notGenerated++;
    else if (s === 'DRAFT') counts.draft++;
    else if (s === 'APPROVED') counts.approved++;
    else counts.locked++;
  }
  return counts;
}

/**
 * Which question set a candidate is given when they start a round.
 *   own      their personalised set is ready
 *   pending  they have a personalised set that is still a draft: wait for the admin rather than silently using another
 *   shared   they have none, so the job-wide set is used
 */
export function chooseSet(own: { status: SetStatus } | null | undefined): 'own' | 'pending' | 'shared' {
  if (!own) return 'shared';
  return own.status === 'DRAFT' ? 'pending' : 'own';
}
