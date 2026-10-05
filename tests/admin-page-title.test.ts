import { describe, expect, it } from 'vitest';
import { adminPageHeading } from '@/lib/admin-page-title';

const title = (p: string) => adminPageHeading(p, 'Asha').title;

describe('adminPageHeading', () => {
  it('names every admin page', () => {
    expect(title('/admin')).toBe('Dashboard');
    expect(title('/admin/jobs')).toBe('Jobs');
    expect(title('/admin/jobs/new')).toBe('New job');
    expect(title('/admin/jobs/abc123')).toBe('Job details');
    expect(title('/admin/jobs/abc123/questions')).toBe('Question sets');
    expect(title('/admin/candidates')).toBe('Candidates');
    expect(title('/admin/candidates/xyz')).toBe('Candidate details');
    expect(title('/admin/candidates/xyz/questions/HR')).toBe('Candidate questions');
    expect(title('/admin/results')).toBe('Results');
  });
  it('ignores a trailing slash and greets the admin by name on the dashboard', () => {
    expect(title('/admin/jobs/')).toBe('Jobs');
    expect(adminPageHeading('/admin', 'Asha').subtitle).toContain('Asha');
  });
  it('has a title and description for every page', () => {
    for (const p of ['/admin', '/admin/jobs', '/admin/candidates', '/admin/results', '/admin/jobs/new']) expect(adminPageHeading(p, 'A').subtitle.length).toBeGreaterThan(0);
  });
});
