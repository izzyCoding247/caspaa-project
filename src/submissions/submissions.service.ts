import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  Question,
  QuestionType,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertCanViewSubmission,
  assertOwnsAssessment,
  assertStudentInClass,
  AuthUser,
} from '../common/ownership';
import { isAutoGraded } from '../common/is-auto-graded';
import { NotificationsService } from '../notifications/notifications.service';
import { SubmitAssessmentDto } from './dto/submit-assessment.dto';
import { GradeSubmissionDto } from './dto/grade-submission.dto';

interface AnswerRow {
  questionId: string;
  response: string | undefined;
  isCorrect: boolean | null;
  autoScored: boolean;
}

interface AutoGradeResult {
  status: SubmissionStatus;
  autoScore?: number;
  answerRows?: AnswerRow[];
  gradeToCreate?: { score: number; gradedById: null };
}

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // Shared by submit() and resubmit() — the shape a submission must take is
  // determined entirely by assessment.type, fetched server-side, never
  // trusted from the client, regardless of which action triggered it.
  private validateSubmissionShape(
    questions: Question[],
    autoGraded: boolean,
    dto: SubmitAssessmentDto,
  ): void {
    if (autoGraded) {
      if (dto.answers === undefined) {
        throw new BadRequestException(
          'This assessment requires an answers array.',
        );
      }
      if (dto.textContent || dto.fileUrl) {
        throw new BadRequestException(
          'CBT/quick-test submissions do not accept text or file content.',
        );
      }

      const validQuestionIds = new Set(questions.map((q) => q.id));
      for (const answer of dto.answers) {
        if (!validQuestionIds.has(answer.questionId)) {
          throw new BadRequestException(
            `Question ${answer.questionId} does not belong to this assessment.`,
          );
        }
      }
    } else {
      if (dto.answers && dto.answers.length > 0) {
        throw new BadRequestException(
          'Assignments do not accept an answers array.',
        );
      }
      if (!dto.textContent && !dto.fileUrl) {
        throw new BadRequestException(
          'This assignment requires text or a file.',
        );
      }
    }
  }

  // Shared by submit() and resubmit() — a resubmission reruns this against
  // the NEW answers rather than carrying the old autoScore forward; the
  // student is answering again, and correctness has to reflect the new
  // attempt.
  private buildAutoGradeResult(
    questions: Question[],
    autoGraded: boolean,
    dto: SubmitAssessmentDto,
  ): AutoGradeResult {
    if (!autoGraded) {
      return { status: SubmissionStatus.PENDING_REVIEW };
    }

    const questionsById = new Map(questions.map((q) => [q.id, q]));
    const answerRows: AnswerRow[] = (dto.answers ?? []).map((a) => {
      const question = questionsById.get(a.questionId)!;
      const autoScorable =
        question.type === QuestionType.MCQ ||
        question.type === QuestionType.TRUE_FALSE;
      const isCorrect = autoScorable
        ? question.correctAnswer === a.response
        : null;
      return {
        questionId: a.questionId,
        response: a.response,
        isCorrect,
        autoScored: autoScorable,
      };
    });

    const autoScore = answerRows.filter((a) => a.isCorrect === true).length;
    const hasShortAnswer = questions.some(
      (q) => q.type === QuestionType.SHORT_ANSWER,
    );

    if (hasShortAnswer) {
      return { status: SubmissionStatus.PENDING_REVIEW, autoScore, answerRows };
    }

    return {
      status: SubmissionStatus.GRADED,
      autoScore,
      answerRows,
      gradeToCreate: { score: autoScore, gradedById: null },
    };
  }

  async submit(user: AuthUser, assessmentId: string, dto: SubmitAssessmentDto) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      include: { questions: true },
    });
    if (!assessment) {
      throw new NotFoundException('Assessment not found.');
    }

    const student = await this.prisma.user.findUnique({
      where: { id: user.userId },
    });
    if (!student) {
      throw new NotFoundException('Student not found.');
    }

    assertStudentInClass(user, student, assessment);

    const existing = await this.prisma.submission.findFirst({
      where: { assessmentId, studentId: user.userId, isLatest: true },
    });
    if (existing) {
      throw new ConflictException(
        'You have already submitted this assessment.',
      );
    }

    const autoGraded = isAutoGraded(assessment);

    if (autoGraded && assessment.dueDate < new Date()) {
      throw new ForbiddenException(
        'This assessment is overdue and can no longer be submitted.',
      );
    }

    this.validateSubmissionShape(assessment.questions, autoGraded, dto);
    const result = this.buildAutoGradeResult(
      assessment.questions,
      autoGraded,
      dto,
    );

    // Nested create is an implicit Prisma transaction — submission, answers,
    // and the immediate grade (if any) either all persist together or none do.
    const submission = await this.prisma.submission.create({
      data: {
        assessmentId,
        studentId: user.userId,
        textContent: dto.textContent,
        fileUrl: dto.fileUrl,
        fileType: dto.fileType,
        status: result.status,
        autoScore: result.autoScore,
        answers: result.answerRows?.length
          ? { create: result.answerRows }
          : undefined,
        grade: result.gradeToCreate
          ? { create: result.gradeToCreate }
          : undefined,
      },
      include: { answers: true, grade: true },
    });

    // Resubmit (Phase 7) calls this same method from the same trigger
    // point, not a new design decision — just a second call site.
    await this.notificationsService.create(
      assessment.teacherId,
      NotificationType.SUBMITTED,
      {
        submissionId: submission.id,
        assessmentId,
        studentId: user.userId,
      },
    );

    return submission;
  }

  async findOne(user: AuthUser, submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assessment: { include: { class: true } },
        // select, not include — passwordHash must never leave this
        // function. Caught this leaking in live verification before it
        // shipped: include: { studentLinks: true } pulls the FULL User
        // row, hash included.
        student: {
          select: {
            id: true,
            name: true,
            email: true,
            classId: true,
            studentLinks: true,
          },
        },
        answers: true,
        grade: true,
        comments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }

    assertCanViewSubmission(user, submission);

    return submission;
  }

  async resubmit(
    user: AuthUser,
    submissionId: string,
    dto: SubmitAssessmentDto,
  ) {
    const oldSubmission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assessment: { include: { questions: true } } },
    });
    if (!oldSubmission) {
      throw new NotFoundException('Submission not found.');
    }

    if (oldSubmission.studentId !== user.userId) {
      throw new ForbiddenException('You may only resubmit your own work.');
    }

    const student = await this.prisma.user.findUnique({
      where: { id: user.userId },
    });
    if (!student) {
      throw new NotFoundException('Student not found.');
    }
    assertStudentInClass(user, student, oldSubmission.assessment);

    // status alone isn't enough: a superseded submission KEEPS status
    // RETURNED forever (it's preserved history, never mutated) — only
    // isLatest actually distinguishes "the current returned submission"
    // from "an old one that's already been resubmitted." Without this
    // second check, a second resubmit attempt on the same old row passes
    // the status check and only fails deep inside the transaction, when
    // previousSubmissionId's @unique constraint rejects the duplicate —
    // caught live as an unhandled 500 instead of a clean 400.
    if (
      oldSubmission.status !== SubmissionStatus.RETURNED ||
      !oldSubmission.isLatest
    ) {
      throw new BadRequestException('Only returned work may be resubmitted.');
    }

    const assessment = oldSubmission.assessment;
    const autoGraded = isAutoGraded(assessment);

    if (autoGraded && assessment.dueDate < new Date()) {
      throw new ForbiddenException(
        'This assessment is overdue and can no longer be submitted.',
      );
    }

    this.validateSubmissionShape(assessment.questions, autoGraded, dto);
    const result = this.buildAutoGradeResult(
      assessment.questions,
      autoGraded,
      dto,
    );

    // New row + flip, one explicit transaction — unlike submit()'s nested
    // create, this is two independent top-level writes (update the old row,
    // create the new one), which Prisma does not implicitly wrap together.
    // This is exactly where the "at most one isLatest: true per student per
    // assessment" invariant named back in Phase 1 gets enforced: without
    // atomicity here, a crash between the two writes could leave two
    // isLatest: true rows for the same assessment.
    const newSubmission = await this.prisma.$transaction(async (tx) => {
      await tx.submission.update({
        where: { id: submissionId },
        data: { isLatest: false },
      });

      return tx.submission.create({
        data: {
          assessmentId: assessment.id,
          studentId: user.userId,
          textContent: dto.textContent,
          fileUrl: dto.fileUrl,
          fileType: dto.fileType,
          status: result.status,
          autoScore: result.autoScore,
          previousSubmissionId: submissionId,
          isLatest: true,
          answers: result.answerRows?.length
            ? { create: result.answerRows }
            : undefined,
          grade: result.gradeToCreate
            ? { create: result.gradeToCreate }
            : undefined,
        },
        include: { answers: true, grade: true },
      });
    });

    await this.notificationsService.create(
      assessment.teacherId,
      NotificationType.RESUBMITTED,
      {
        submissionId: newSubmission.id,
        previousSubmissionId: submissionId,
        assessmentId: assessment.id,
        studentId: user.userId,
      },
    );

    return newSubmission;
  }

  async grade(user: AuthUser, submissionId: string, dto: GradeSubmissionDto) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assessment: { include: { class: true } } },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }

    assertOwnsAssessment(user, submission.assessment);

    // Folds the teacher's manual component into any existing autoScore
    // (e.g. a mixed CBT's short-answer score on top of the auto-graded
    // portion) rather than requiring them to re-derive the objective part.
    const finalScore = (submission.autoScore ?? 0) + dto.score;

    // Upsert, not create — a teacher saving a draft grade then coming back
    // to adjust it before returning is the normal workflow, and
    // Grade.submissionId is @unique, so a plain create would throw on the
    // second save.
    return this.prisma.grade.upsert({
      where: { submissionId },
      create: {
        submissionId,
        score: finalScore,
        status: dto.status,
        feedback: dto.feedback,
        gradedById: user.userId,
      },
      update: {
        score: finalScore,
        status: dto.status,
        feedback: dto.feedback,
        gradedById: user.userId,
        gradedAt: new Date(),
      },
    });
  }

  async return(user: AuthUser, submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assessment: { include: { class: true } },
        grade: true,
        student: { select: { studentLinks: true } },
      },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }

    assertOwnsAssessment(user, submission.assessment);

    if (!submission.grade) {
      throw new BadRequestException(
        'Cannot return a submission that has not been graded.',
      );
    }

    const updated = await this.prisma.submission.update({
      where: { id: submissionId },
      data: { status: SubmissionStatus.RETURNED, returnedAt: new Date() },
    });

    const payload = {
      submissionId,
      assessmentId: submission.assessmentId,
      score: submission.grade.score,
    };

    await this.notificationsService.create(
      submission.studentId,
      NotificationType.RETURNED,
      payload,
    );

    for (const link of submission.student.studentLinks) {
      await this.notificationsService.create(
        link.parentId,
        NotificationType.RETURNED,
        payload,
      );
    }

    return updated;
  }
}
