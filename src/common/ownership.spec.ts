import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import {
  assertOwnsAssessment,
  assertCanViewSubmission,
  assertStudentInClass,
  AuthUser,
} from './ownership';

type AssessmentArg = Parameters<typeof assertOwnsAssessment>[1];
type SubmissionArg = Parameters<typeof assertCanViewSubmission>[1];
type StudentArg = Parameters<typeof assertStudentInClass>[1];
type ClassScopedAssessmentArg = Parameters<typeof assertStudentInClass>[2];

describe('assertOwnsAssessment', () => {
  const teacherId = 'teacher-1';

  const assessment = {
    class: { teacherId },
  } as unknown as AssessmentArg;

  it('allows a teacher who owns the assessment', () => {
    const user: AuthUser = { userId: teacherId, role: Role.TEACHER };
    expect(() => assertOwnsAssessment(user, assessment)).not.toThrow();
  });

  it('denies a teacher from a different class', () => {
    const user: AuthUser = { userId: 'teacher-2', role: Role.TEACHER };
    expect(() => assertOwnsAssessment(user, assessment)).toThrow(
      ForbiddenException,
    );
  });

  it('denies a role that is never allowed to own an assessment', () => {
    const user: AuthUser = { userId: teacherId, role: Role.STUDENT };
    expect(() => assertOwnsAssessment(user, assessment)).toThrow(
      ForbiddenException,
    );
  });

  it('allows admin regardless of ownership', () => {
    const user: AuthUser = { userId: 'admin-1', role: Role.ADMIN };
    expect(() => assertOwnsAssessment(user, assessment)).not.toThrow();
  });
});

describe('assertCanViewSubmission', () => {
  const teacherId = 'teacher-1';
  const studentId = 'student-1';
  const parentId = 'parent-1';

  const submission = {
    studentId,
    assessment: {
      class: { teacherId },
    },
    student: {
      studentLinks: [{ parentId, studentId }],
    },
  } as unknown as SubmissionArg;

  it('allows the owning teacher', () => {
    const user: AuthUser = { userId: teacherId, role: Role.TEACHER };
    expect(() => assertCanViewSubmission(user, submission)).not.toThrow();
  });

  it('denies a teacher from a different class', () => {
    const user: AuthUser = { userId: 'teacher-2', role: Role.TEACHER };
    expect(() => assertCanViewSubmission(user, submission)).toThrow(
      ForbiddenException,
    );
  });

  it('allows the submitting student', () => {
    const user: AuthUser = { userId: studentId, role: Role.STUDENT };
    expect(() => assertCanViewSubmission(user, submission)).not.toThrow();
  });

  it('denies a different student', () => {
    const user: AuthUser = { userId: 'student-2', role: Role.STUDENT };
    expect(() => assertCanViewSubmission(user, submission)).toThrow(
      ForbiddenException,
    );
  });

  it('allows a linked parent', () => {
    const user: AuthUser = { userId: parentId, role: Role.PARENT };
    expect(() => assertCanViewSubmission(user, submission)).not.toThrow();
  });

  it('denies an unlinked parent', () => {
    const user: AuthUser = { userId: 'parent-2', role: Role.PARENT };
    expect(() => assertCanViewSubmission(user, submission)).toThrow(
      ForbiddenException,
    );
  });

  it('allows admin regardless of any relation', () => {
    const user: AuthUser = { userId: 'admin-1', role: Role.ADMIN };
    expect(() => assertCanViewSubmission(user, submission)).not.toThrow();
  });
});

describe('assertStudentInClass', () => {
  const classId = 'class-1';
  const assessment = { classId } as unknown as ClassScopedAssessmentArg;

  it('allows a student enrolled in the class', () => {
    const user: AuthUser = { userId: 'student-1', role: Role.STUDENT };
    const student = { classId } as unknown as StudentArg;
    expect(() => assertStudentInClass(user, student, assessment)).not.toThrow();
  });

  it('denies a student enrolled in a different class', () => {
    const user: AuthUser = { userId: 'student-1', role: Role.STUDENT };
    const student = { classId: 'class-2' } as unknown as StudentArg;
    expect(() => assertStudentInClass(user, student, assessment)).toThrow(
      ForbiddenException,
    );
  });

  it('denies a student not enrolled in any class', () => {
    const user: AuthUser = { userId: 'student-1', role: Role.STUDENT };
    const student = { classId: null } as unknown as StudentArg;
    expect(() => assertStudentInClass(user, student, assessment)).toThrow(
      ForbiddenException,
    );
  });

  it('allows admin regardless of class membership', () => {
    const user: AuthUser = { userId: 'admin-1', role: Role.ADMIN };
    const student = { classId: null } as unknown as StudentArg;
    expect(() => assertStudentInClass(user, student, assessment)).not.toThrow();
  });
});
