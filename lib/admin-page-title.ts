// The title and one-line description shown in the admin top bar, chosen from the page address.
// Pure so it can be tested; the top bar component only calls it.

export interface PageHeading {
  title: string;
  subtitle: string;
}

export function adminPageHeading(pathname: string, adminName: string): PageHeading {
  const path = pathname.replace(/\/+$/, '') || '/admin';
  const parts = path.split('/').filter(Boolean); // ['admin', 'jobs', '<id>', 'questions']

  if (parts.length <= 1) return { title: 'Dashboard', subtitle: `Welcome back, ${adminName}! Here is what is happening with your hiring process.` };

  const [, section, id, sub] = parts;
  if (section === 'jobs') {
    if (id === 'new') return { title: 'New job', subtitle: 'Set up a job and its interview pipeline.' };
    if (!id) return { title: 'Jobs', subtitle: 'Manage your job openings and their interview pipelines.' };
    if (sub === 'questions') return { title: 'Question sets', subtitle: 'Generate, review and approve the questions candidates will see.' };
    return { title: 'Job details', subtitle: 'Pipeline, candidates and settings for this job.' };
  }
  if (section === 'candidates') {
    if (!id) return { title: 'Candidates', subtitle: 'Register, review and decide on candidates for your jobs.' };
    if (sub === 'questions') return { title: 'Candidate questions', subtitle: 'The questions this candidate was given in this round.' };
    return { title: 'Candidate details', subtitle: 'Answers, scores and the final decision.' };
  }
  if (section === 'results') return { title: 'Results', subtitle: 'Weighted scores and suggested decisions. Nothing is final until you confirm it.' };
  return { title: 'Admin', subtitle: '' };
}
