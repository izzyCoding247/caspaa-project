import { isOverdue } from './is-overdue';

describe('isOverdue', () => {
  it('returns true when dueDate is in the past', () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(isOverdue({ dueDate: pastDate })).toBe(true);
  });

  it('returns false when dueDate is in the future', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    expect(isOverdue({ dueDate: futureDate })).toBe(false);
  });
});
