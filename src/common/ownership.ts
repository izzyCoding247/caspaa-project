import { ForbiddenException } from '@nestjs/common';
import {
  Assessment,
  Class,
  ParentStudentLink,
  Role,
  Submission,
  User,
} from '@prisma/client';

export interface AuthUser {
  userId: string;
  role: Role;
}

type AssessmentWithClass = Assessment & { class: Class };

/**
 * A teacher owns an Assessment through its Class; admin bypasses.
 * Call after fetching the assessment with `include: { class: true }`.
 */
export function assertOwnsAssessment(
  user: AuthUser,
  assessment: AssessmentWithClass,
): void {
  if (user.role === Role.ADMIN) return;

  if (
    user.role === Role.TEACHER &&
    assessment.class.teacherId === user.userId
  ) {
    return;
  }

  throw new ForbiddenException('You do not have access to this assessment.');
}

type SubmissionForOwnershipCheck = Submission & {
  assessment: AssessmentWithClass;
  student: { studentLinks: ParentStudentLink[] };
};

/**
 * Three distinct ownership shapes: teacher (via Assessment -> Class),
 * student (direct), parent (via ParentStudentLink); admin bypasses.
 * Call after fetching the submission with:
 *   include: { assessment: { include: { class: true } }, student: { include: { studentLinks: true } } }
 */
export function assertCanViewSubmission(
  user: AuthUser,
  submission: SubmissionForOwnershipCheck,
): void {
  if (user.role === Role.ADMIN) return;

  if (
    user.role === Role.TEACHER &&
    submission.assessment.class.teacherId === user.userId
  ) {
    return;
  }

  if (user.role === Role.STUDENT && submission.studentId === user.userId) {
    return;
  }

  if (
    user.role === Role.PARENT &&
    submission.student.studentLinks.some(
      (link) => link.parentId === user.userId,
    )
  ) {
    return;
  }

  throw new ForbiddenException('You do not have access to this submission.');
}

/**
 * A student may only act on an assessment belonging to their own class;
 * admin bypasses. Call with the already-fetched student (for their
 * classId) and assessment.
 */
export function assertStudentInClass(
  user: AuthUser,
  student: Pick<User, 'classId'>,
  assessment: Pick<Assessment, 'classId'>,
): void {
  if (user.role === Role.ADMIN) return;

  if (student.classId !== null && student.classId === assessment.classId) {
    return;
  }

  throw new ForbiddenException('You are not enrolled in this class.');
}
