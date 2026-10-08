// What each email says. Pure functions: the same input always gives the same subject and body, so they are unit tested
// (tests/email-templates.test.ts).
//
// Two rules hold for every email:
//  - The password is described ("your date of birth as DDMMYYYY"), never written out. The platform only keeps a hash of the
//    date of birth, and a password in an email would sit in an inbox for years.
//  - No email says whether a candidate was shortlisted or rejected. "Your result is ready" only points to the sign-in page,
//    where the candidate sees it with the rest of their results.
import type { EmailKind } from '@/lib/email-core';

export interface EmailContext {
  name: string;
  jobTitle: string;
  candidateCode: string;
  /** Sign-in page with the Candidate ID filled in. */
  loginUrl: string;
  /** Enabled rounds in order, e.g. ["Assessment", "Coding", "Technical", "HR"]. */
  roundLabels: string[];
  /** Any round uses the camera. */
  usesCamera: boolean;
  /** For "selected for the next round": the round they take next, when known. */
  nextRoundLabel: string | null;
}

export interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** One line only: a line break in a subject could add mail headers. */
export function safeSubject(value: string): string {
  return value.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150);
}

function clip(value: string, max: number): string {
  const one = value.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

const PASSWORD_LINE = 'Password: your date of birth as DDMMYYYY (for example, born on 5 March 2001 → 05032001).';

interface Parts {
  subject: string;
  /** Paragraphs before the login box. */
  intro: string[];
  /** Show the Candidate ID and password lines. */
  showCredentials: boolean;
  buttonLabel: string;
  /** Paragraphs after the login box. */
  outro: string[];
}

function parts(kind: EmailKind, c: EmailContext): Parts {
  const job = clip(c.jobTitle, 80);
  const rounds = c.roundLabels.length > 0 ? `The interview has ${c.roundLabels.length} round${c.roundLabels.length === 1 ? '' : 's'}: ${c.roundLabels.join(', ')}.` : null;
  const setup = [
    'Use a laptop or desktop computer with a stable internet connection.',
    ...(c.usesCamera ? ['Some rounds use your camera, so allow camera access when asked.'] : []),
    'Each round is timed once you start it, so begin when you can finish without interruption.',
  ];

  switch (kind) {
    case 'INVITE':
      return {
        subject: `Your interview for ${job}: login details`,
        intro: [`You have been invited to take the online interview for ${job}.`, ...(rounds ? [rounds] : [])],
        showCredentials: true,
        buttonLabel: 'Log in to start',
        outro: setup,
      };
    case 'REMINDER':
      return {
        subject: `Reminder: your ${job} interview is waiting`,
        intro: [`You have not started your online interview for ${job} yet.`, ...(rounds ? [rounds] : [])],
        showCredentials: true,
        buttonLabel: 'Log in to start',
        outro: setup,
      };
    case 'SELECTED_NEXT_ROUND':
      return {
        subject: `You are through to the next round: ${job}`,
        intro: [
          `Good news: the hiring team has reviewed your results for ${job} and you are selected to continue.`,
          c.nextRoundLabel ? `Your next round is ${c.nextRoundLabel}.` : 'Log in to see your next round.',
        ],
        showCredentials: false,
        buttonLabel: 'Continue the interview',
        outro: [`Sign in with your Candidate ID (${c.candidateCode}) and the same password as before.`],
      };
    case 'RESULT_READY':
      return {
        subject: `Your interview result is ready: ${job}`,
        intro: [`Your result for the ${job} interview is ready.`, 'Log in to see your scores and the outcome.'],
        showCredentials: false,
        buttonLabel: 'View my result',
        outro: [`Sign in with your Candidate ID (${c.candidateCode}) and the same password as before.`],
      };
  }
}

const FOOTER = 'You received this email because the hiring team registered this address for an online interview. If you were not expecting it, you can ignore it.';

export function buildEmail(kind: EmailKind, c: EmailContext): BuiltEmail {
  const p = parts(kind, c);
  const greeting = `Hi ${clip(c.name, 80)},`;
  const credentialLines = p.showCredentials ? [`Candidate ID: ${c.candidateCode}`, PASSWORD_LINE] : [];

  const text = [
    greeting,
    '',
    ...p.intro.flatMap((x) => [x, '']),
    `${p.buttonLabel}: ${c.loginUrl}`,
    ...(credentialLines.length ? ['', ...credentialLines] : []),
    '',
    ...p.outro.flatMap((x) => [x, '']),
    FOOTER,
  ].join('\n');

  const para = (x: string) => `<p style="margin:0 0 14px;line-height:1.5">${escapeHtml(x)}</p>`;
  const html = [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">',
    para(greeting),
    ...p.intro.map(para),
    `<p style="margin:22px 0"><a href="${escapeHtml(c.loginUrl)}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold;display:inline-block">${escapeHtml(p.buttonLabel)}</a></p>`,
    ...(p.showCredentials
      ? [
          `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin:0 0 18px">`,
          `<p style="margin:0 0 6px">Candidate ID: <strong style="font-family:Consolas,monospace">${escapeHtml(c.candidateCode)}</strong></p>`,
          `<p style="margin:0">${escapeHtml(PASSWORD_LINE)}</p>`,
          '</div>',
        ]
      : []),
    ...p.outro.map(para),
    `<p style="margin:0 0 6px;font-size:12px;color:#64748b;word-break:break-all">If the button does not work, copy this address into your browser: ${escapeHtml(c.loginUrl)}</p>`,
    `<p style="margin:0;font-size:12px;color:#64748b">${escapeHtml(FOOTER)}</p>`,
    '</div></body></html>',
  ].join('');

  return { subject: safeSubject(p.subject), text, html };
}
