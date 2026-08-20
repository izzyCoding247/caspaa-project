import { AssessmentType } from '@prisma/client';
import { isAutoGraded } from './is-auto-graded';

describe('isAutoGraded', () => {
  it('returns true for a CBT', () => {
    expect(isAutoGraded({ type: AssessmentType.CBT })).toBe(true);
  });

  it('returns false for an ASSIGNMENT', () => {
    expect(isAutoGraded({ type: AssessmentType.ASSIGNMENT })).toBe(false);
  });

  it('ignores isQuickTest entirely — a quick test is just a CBT with a display flag', () => {
    const quickTest = { type: AssessmentType.CBT, isQuickTest: true };
    expect(isAutoGraded(quickTest)).toBe(true);
  });
});
