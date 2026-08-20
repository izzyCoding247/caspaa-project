import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/ownership';
import { CreateAssessmentDto } from './dto/create-assessment.dto';

@Injectable()
export class AssessmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: AuthUser, dto: CreateAssessmentDto) {
    const klass = await this.prisma.class.findUnique({
      where: { id: dto.classId },
    });
    if (!klass) {
      throw new NotFoundException('Class not found.');
    }
    if (klass.teacherId !== user.userId) {
      throw new ForbiddenException('You do not own this class.');
    }

    // Nested create is an implicit Prisma transaction — the assessment and
    // its questions either all persist together or none do.
    return this.prisma.assessment.create({
      data: {
        title: dto.title,
        description: dto.description,
        type: dto.type,
        isQuickTest: dto.isQuickTest ?? false,
        classId: dto.classId,
        teacherId: user.userId,
        subject: dto.subject,
        attachment: dto.attachment,
        rubric: dto.rubric as Prisma.InputJsonValue | undefined,
        dueDate: new Date(dto.dueDate),
        questions: dto.questions
          ? {
              create: dto.questions.map((q, index) => ({
                type: q.type,
                text: q.text,
                options: q.options,
                correctAnswer: q.correctAnswer,
                order: index,
              })),
            }
          : undefined,
      },
      include: { questions: true },
    });
  }

  async findAll(user: AuthUser) {
    let where: Prisma.AssessmentWhereInput = {};

    switch (user.role) {
      case Role.ADMIN:
        where = {};
        break;
      case Role.TEACHER:
        where = { class: { teacherId: user.userId } };
        break;
      case Role.STUDENT:
        where = { class: { students: { some: { id: user.userId } } } };
        break;
      case Role.PARENT:
        where = {
          class: {
            students: {
              some: { studentLinks: { some: { parentId: user.userId } } },
            },
          },
        };
        break;
    }

    return this.prisma.assessment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(user: AuthUser, id: string) {
    const assessment = await this.prisma.assessment.findUnique({
      where: { id },
      include: { questions: true },
    });
    if (!assessment) {
      throw new NotFoundException('Assessment not found.');
    }

    if (user.role === Role.STUDENT || user.role === Role.PARENT) {
      return {
        ...assessment,
        questions: assessment.questions.map((question) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { correctAnswer: _correctAnswer, ...rest } = question;
          return rest;
        }),
      };
    }

    return assessment;
  }
}
