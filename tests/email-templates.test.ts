import { describe, expect, it } from 'vitest';
import { buildEmail, escapeHtml, safeSubject, type EmailContext } from '@/lib/email-templates';
import type { EmailKind } from '@/lib/email-core';

const ctx: EmailContext = {
  name: 'Asha Verma',
  jobTitle: 'Backend Engineer',
  candidateCode: 'CAND-KQMT1001',
  loginUrl: 'https://interview.example.com/login?code=CAND-KQMT1001',
  roundLabels: ['Assessment', 'Coding', 'Technical', 'HR'],
  usesCamera: true,
  nextRoundLabel: 'Coding',
};
const KINDS: EmailKind[] = ['INVITE', 'REMINDER', 'SELECTED_NEXT_ROUND', 'RESULT_READY'];

describe('email wording', () => {
  it('every email has a subject, a text body, an HTML body and the sign-in link', () => {
    for (const kind of KINDS) {
      const m = buildEmail(kind, ctx);
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.text).toContain(ctx.loginUrl);
      expect(m.html).toContain(escapeHtml(ctx.loginUrl));
      expect(m.text).toContain('Hi Asha Verma,');
    }
  });
  it('the invitation and the reminder give the Candidate ID and describe the password without revealing it', () => {
    for (const kind of ['INVITE', 'REMINDER'] as const) {
      const m = buildEmail(kind, ctx);
      expect(m.text).toContain('Candidate ID: CAND-KQMT1001');
      expect(m.text).toContain('DDMMYYYY');
      expect(m.html).toContain('CAND-KQMT1001');
    }
  });
  it('never contains a date of birth: the context has no such field, and the only 8-digit value is the labelled example', () => {
    expect(Object.keys(ctx)).not.toContain('dob');
    for (const kind of KINDS) {
      const m = buildEmail(kind, ctx);
      expect(`${m.text} ${m.html}`.replaceAll('05032001', '').replaceAll('5 March 2001', '')).not.toMatch(/\b\d{8}\b/);
    }
  });
  it('result and next-round emails never say whether the candidate passed', () => {
    for (const kind of ['RESULT_READY', 'SELECTED_NEXT_ROUND'] as const) {
      const m = buildEmail(kind, ctx);
      expect(`${m.subject} ${m.text}`).not.toMatch(/reject|shortlist|unsuccessful|regret|congratulat|disqualif/i);
    }
  });
  it('the result email only points to the sign-in page', () => {
    const m = buildEmail('RESULT_READY', ctx);
    expect(m.subject).toContain('result is ready');
    expect(m.text).not.toContain('Candidate ID: ');
    expect(m.text).not.toMatch(/\d+\s*%/);
  });
  it('the next-round email names the round when known and still works when not', () => {
    expect(buildEmail('SELECTED_NEXT_ROUND', ctx).text).toContain('Your next round is Coding.');
    expect(buildEmail('SELECTED_NEXT_ROUND', { ...ctx, nextRoundLabel: null }).text).toContain('Log in to see your next round.');
  });
  it('mentions the camera only when a round uses it', () => {
    expect(buildEmail('INVITE', ctx).text).toContain('camera');
    expect(buildEmail('INVITE', { ...ctx, usesCamera: false }).text).not.toContain('camera');
  });
  it('lists the rounds, with the right plural', () => {
    expect(buildEmail('INVITE', ctx).text).toContain('4 rounds: Assessment, Coding, Technical, HR.');
    expect(buildEmail('INVITE', { ...ctx, roundLabels: ['Assessment'] }).text).toContain('1 round: Assessment.');
  });
});

describe('untrusted text', () => {
  const evil: EmailContext = { ...ctx, name: '<script>alert(1)</script>', jobTitle: 'Dev <img src=x onerror=alert(1)>' };
  it('escapes names and job titles in the HTML body', () => {
    for (const kind of KINDS) {
      const m = buildEmail(kind, evil);
      expect(m.html).not.toContain('<script>');
      expect(m.html).not.toContain('<img');
      expect(m.html).toContain('&lt;script&gt;');
    }
  });
  it('keeps the subject on one line so it cannot add headers', () => {
    const m = buildEmail('INVITE', { ...ctx, jobTitle: 'Dev\r\nBcc: attacker@example.com' });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(safeSubject('a\r\nb\u2028c')).toBe('a b c');
    expect(safeSubject('x'.repeat(500)).length).toBe(150);
  });
  it('escapes every special character', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });
  it('cuts a very long name or title', () => {
    const m = buildEmail('INVITE', { ...ctx, name: 'N'.repeat(500), jobTitle: 'J'.repeat(500) });
    expect(m.text.split('\n')[0].length).toBeLessThan(100);
    expect(m.subject.length).toBeLessThanOrEqual(150);
  });
});
