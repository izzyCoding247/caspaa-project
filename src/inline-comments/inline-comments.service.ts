import { Injectable, NotFoundException } from '@nestjs/common';
import { CommentType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertCanViewSubmission,
  assertOwnsAssessment,
  AuthUser,
} from '../common/ownership';
import { CreateAnnotationDto } from './dto/create-annotation.dto';

@Injectable()
export class InlineCommentsService {
  constructor(private readonly prisma: PrismaService) {}

  private async fetchSubmissionForOwnerAction(submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assessment: { include: { class: true } } },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }
    return submission;
  }

  async create(user: AuthUser, submissionId: string, dto: CreateAnnotationDto) {
    const submission = await this.fetchSubmissionForOwnerAction(submissionId);
    assertOwnsAssessment(user, submission.assessment);

    if (dto.type === CommentType.PIN) {
      // Advisory lock scoped to this submission serializes "read max number,
      // then insert" per submission, without blocking unrelated submissions.
      // A bare transaction alone does NOT prevent this race under Postgres's
      // default READ COMMITTED isolation.
      return this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${submissionId}))`;

        const agg = await tx.inlineComment.aggregate({
          where: { submissionId, type: CommentType.PIN },
          _max: { number: true },
        });
        const number = (agg._max.number ?? 0) + 1;

        return tx.inlineComment.create({
          data: {
            submissionId,
            authorId: user.userId,
            type: dto.type,
            x: dto.x,
            y: dto.y,
            color: dto.color,
            page: dto.page,
            number,
            text: dto.text,
          },
        });
      });
    }

    return this.prisma.inlineComment.create({
      data: {
        submissionId,
        authorId: user.userId,
        type: dto.type,
        x: dto.x,
        y: dto.y,
        width: dto.width,
        height: dto.height,
        points: dto.points as unknown as Prisma.InputJsonValue | undefined,
        color: dto.color,
        strokeWidth: dto.strokeWidth,
        page: dto.page,
        text: dto.text,
      },
    });
  }

  async findAll(user: AuthUser, submissionId: string) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: {
        assessment: { include: { class: true } },
        student: { select: { studentLinks: true } },
      },
    });
    if (!submission) {
      throw new NotFoundException('Submission not found.');
    }

    assertCanViewSubmission(user, submission);

    // Ordered by creation time: pins carry their own persisted number, but
    // strokes/highlights have no identity beyond draw order — replaying
    // them out of sequence would reconstruct a different drawing.
    return this.prisma.inlineComment.findMany({
      where: { submissionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async remove(user: AuthUser, annotationId: string) {
    const annotation = await this.prisma.inlineComment.findUnique({
      where: { id: annotationId },
      include: {
        submission: { include: { assessment: { include: { class: true } } } },
      },
    });
    if (!annotation) {
      throw new NotFoundException('Annotation not found.');
    }

    assertOwnsAssessment(user, annotation.submission.assessment);

    await this.prisma.inlineComment.delete({ where: { id: annotationId } });
  }
}
