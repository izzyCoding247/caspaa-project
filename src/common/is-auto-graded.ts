import { Assessment, AssessmentType } from '@prisma/client';

/**
 * Single source of truth for "behaves like a CBT" — independent of the
 * isQuickTest display flag, so quick tests inherit CBT behavior (auto-grade,
 * overdue block) automatically rather than needing a separate branch.
 */
export function isAutoGraded(assessment: Pick<Assessment, 'type'>): boolean {
  return assessment.type === AssessmentType.CBT;
}
