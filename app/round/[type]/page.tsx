import { notFound } from 'next/navigation';
import Link from 'next/link';
import { CodingWorkspace } from '@/components/coding/CodingWorkspace';
import { BackButton } from '@/components/BackButton';
import { GradingPending } from '@/components/GradingPending';
import { ProctorGate } from '@/components/proctoring/ProctorGate';
import { RoundExam } from '@/components/RoundExam';
import { RoundIntro } from '@/components/RoundIntro';
import { RoundResultView } from '@/components/RoundResultView';
import { requireCandidatePage } from '@/lib/auth';
import { ROUND_TYPES } from '@/lib/pipeline';
import { getRoundPage } from '@/lib/rounds';
import { AppError } from '@/lib/http';

export const dynamic = 'force-dynamic';

export default async function RoundPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!(ROUND_TYPES as readonly string[]).includes(type)) notFound();
  const session = await requireCandidatePage();

  let state;
  try {
    state = await getRoundPage(session, type as (typeof ROUND_TYPES)[number]);
  } catch (e) {
    if (e instanceof AppError && e.status === 404) notFound();
    throw e;
  }

  // The coding workspace fills the whole window, like other coding platforms.
  if (state.phase === 'coding') {
    return (
      <ProctorGate enabled={state.coding.round.proctored} faceLevel={state.coding.round.faceLevel} cameraRequired={state.coding.round.cameraRequired} roundType={type} maxTabSwitches={state.coding.round.maxTabSwitches} tabSwitchesUsed={state.coding.round.tabSwitchesUsed ?? 0} blockPaste={state.coding.round.blockPaste}>
        <CodingWorkspace coding={state.coding} />
      </ProctorGate>
    );
  }

  return (
    <main className={`mx-auto space-y-6 p-8 ${state.phase === 'intro' ? 'max-w-5xl' : 'max-w-3xl'}`}>
      {state.phase !== 'exam' && (
        <div className="flex items-center justify-between">
          <BackButton href="/dashboard" label="Back to dashboard" />
        </div>
      )}

      {state.phase === 'intro' && <RoundIntro round={state.round} canStart={state.canStart} blockedReason={state.blockedReason} />}
      {state.phase === 'exam' && (
        <ProctorGate enabled={state.exam.round.proctored} faceLevel={state.exam.round.faceLevel} cameraRequired={state.exam.round.cameraRequired} roundType={type} maxTabSwitches={state.exam.round.maxTabSwitches} tabSwitchesUsed={state.exam.round.tabSwitchesUsed ?? 0} blockPaste={state.exam.round.blockPaste}>
          <RoundExam roundType={type} exam={state.exam} />
        </ProctorGate>
      )}
      {state.phase === 'grading' && <GradingPending round={state.round} />}
      {state.phase === 'result' && (
        <RoundResultView round={state.round} result={state.result} nextHref={state.nextRoundType ? `/round/${state.nextRoundType}` : null}>
          <Link href="/dashboard" className="text-sm font-medium underline">
            Back to dashboard
          </Link>
        </RoundResultView>
      )}
    </main>
  );
}
