import { Assessment } from '@prisma/client';

/**
 * Deliberately type-agnostic — not gated by isAutoGraded. The CBT-specific
 * wording in the acceptance criteria ("Overdue CBT: badge shown") describes
 * where the write-side BLOCK applies (Phase 4), not where this read-side
 * badge is allowed to show. A plain assignment past its due date is still
 * informationally overdue, even though it's never blocked from submission.
 */
export function isOverdue(assessment: Pick<Assessment, 'dueDate'>): boolean {
  return assessment.dueDate < new Date();
}
