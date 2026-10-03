import { Badge } from '@/components/ui/badge';
import { HR_CRITERIA, HR_CRITERION_HELP, HR_CRITERION_LABEL, LEVEL_LABEL, parseHrFeedback, type CriterionLevel } from '@/lib/hr-rubric';

const TONE: Record<CriterionLevel, 'good' | 'warn' | 'bad'> = { strong: 'good', partial: 'warn', weak: 'bad' };

/** The AI's feedback for one typed answer. HR answers also show the four rubric ratings. Admin only. */
export function AnswerFeedback({ roundType, feedback }: { roundType: string; feedback: string }) {
  const { levels, text } = roundType === 'HR' ? parseHrFeedback(feedback) : { levels: null, text: feedback };
  return (
    <div className="mt-2">
      <div className="text-xs font-medium text-muted-foreground">AI feedback (not shown to the candidate)</div>
      {levels && (
        <div className="mt-1 flex flex-wrap gap-1.5">
          {HR_CRITERIA.map((c) => (
            <Badge key={c} tone={TONE[levels[c]]}>
              {HR_CRITERION_LABEL[c]}: {LEVEL_LABEL[levels[c]]}
            </Badge>
          ))}
        </div>
      )}
      <p className={levels ? 'mt-1' : undefined}>{text}</p>
    </div>
  );
}

/** What the four HR criteria mean, so a reviewer can judge a rating without guessing. */
export function HrRubricHelp() {
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer">How HR answers are scored</summary>
      <p className="mt-1">Each answer is rated Strong, Partly or Weak on four criteria with equal weight. The server turns the ratings into points.</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {HR_CRITERIA.map((c) => (
          <li key={c}>
            <span className="font-medium text-foreground">{HR_CRITERION_LABEL[c]}:</span> {HR_CRITERION_HELP[c]}
          </li>
        ))}
      </ul>
    </details>
  );
}
