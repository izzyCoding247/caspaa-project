import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  QuestionType,
  SubmissionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertOwnsAssessment,
  assertStudentInClass,
  AuthUser,
} from '../common/ownership';
import { isAutoGraded } from '../common/is-auto-graded';
import { NotificationsService } from '../notifications/notifications.service';
import { SubmitAssessmentDto } from './dto/submit-assessment.dto';
import { GradeSubmissionDto } from './dto/grade-submission.dto';

@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

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

    // Shape enforced from the real, server-fetched assessment.type — never
    // trusted from what the client happened to send.
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

      const validQuestionIds = new Set(assessment.questions.map((q) => q.id));
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

    let status: SubmissionStatus = SubmissionStatus.PENDING_REVIEW;
    let autoScore: number | undefined;
    let answerRows:
      | {
          questionId: string;
          response: string | undefined;
          isCorrect: boolean | null;
          autoScored: boolean;
        }[]
      | undefined;
    let gradeToCreate: { score: number; gradedById: null } | undefined;

    if (autoGraded) {
      const questionsById = new Map(assessment.questions.map((q) => [q.id, q]));

      answerRows = (dto.answers ?? []).map((a) => {
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

      autoScore = answerRows.filter((a) => a.isCorrect === true).length;

      const hasShortAnswer = assessment.questions.some(
        (q) => q.type === QuestionType.SHORT_ANSWER,
      );
      if (!hasShortAnswer) {
        status = SubmissionStatus.GRADED;
        gradeToCreate = { score: autoScore, gradedById: null };
      }
    }

    // Nested create is an implicit Prisma transaction — submission, answers,
    // and the immediate grade (if any) either all persist together or none do.
    return this.prisma.submission.create({
      data: {
        assessmentId,
        studentId: user.userId,
        textContent: dto.textContent,
        fileUrl: dto.fileUrl,
        fileType: dto.fileType,
        status,
        autoScore,
        answers: answerRows?.length ? { create: answerRows } : undefined,
        grade: gradeToCreate ? { create: gradeToCreate } : undefined,
      },
      include: { answers: true, grade: true },
    });
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
        student: { include: { studentLinks: true } },
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
