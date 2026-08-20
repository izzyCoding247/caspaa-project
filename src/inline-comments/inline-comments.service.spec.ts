import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CommentType, Role } from '@prisma/client';
import { InlineCommentsService } from './inline-comments.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/ownership';
import { CreateAnnotationDto } from './dto/create-annotation.dto';

interface PinCreateArg {
  data: { number: number };
}

interface MockTx {
  $executeRaw: jest.Mock;
  inlineComment: {
    aggregate: jest.Mock;
    create: jest.Mock<Promise<{ id: string }>, [PinCreateArg]>;
  };
}

interface MockPrisma {
  submission: { findUnique: jest.Mock };
  inlineComment: {
    aggregate: jest.Mock;
    create: jest.Mock<Promise<{ id: string }>, [PinCreateArg]>;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    delete: jest.Mock;
  };
  $transaction: jest.Mock<Promise<unknown>, [(tx: MockTx) => Promise<unknown>]>;
}

describe('InlineCommentsService', () => {
  let service: InlineCommentsService;
  let prisma: MockPrisma;

  const teacherId = 'teacher-1';
  const teacher: AuthUser = { userId: teacherId, role: Role.TEACHER };

  const submissionWithAssessment = {
    id: 'submission-1',
    assessment: { id: 'assessment-1', class: { teacherId } },
  };

  beforeEach(async () => {
    prisma = {
      submission: { findUnique: jest.fn() },
      inlineComment: {
        aggregate: jest.fn(),
        create: jest.fn<Promise<{ id: string }>, [PinCreateArg]>(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn<
        Promise<unknown>,
        [(tx: MockTx) => Promise<unknown>]
      >(),
    };

    // Simulate Prisma's $transaction by invoking the callback with a tx
    // client that shares the same mocked shape as the main client.
    prisma.$transaction.mockImplementation((callback) => {
      const tx: MockTx = {
        $executeRaw: jest.fn(),
        inlineComment: {
          aggregate: prisma.inlineComment.aggregate,
          create: prisma.inlineComment.create,
        },
      };
      return callback(tx);
    });

    const module = await Test.createTestingModule({
      providers: [
        InlineCommentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(InlineCommentsService);
  });

  describe('create', () => {
    it('creates a PIN with number computed as max+1', async () => {
      prisma.submission.findUnique.mockResolvedValue(submissionWithAssessment);
      prisma.inlineComment.aggregate.mockResolvedValue({ _max: { number: 2 } });
      prisma.inlineComment.create.mockResolvedValue({ id: 'pin-1', number: 3 });

      const dto: CreateAnnotationDto = {
        type: CommentType.PIN,
        x: 50,
        y: 50,
        color: '#ff0000',
      };

      await service.create(teacher, 'submission-1', dto);

      expect(prisma.$transaction).toHaveBeenCalled();
      const createArg = prisma.inlineComment.create.mock.calls[0][0];
      expect(createArg.data.number).toBe(3);
    });

    it('starts pin numbering at 1 when none exist yet', async () => {
      prisma.submission.findUnique.mockResolvedValue(submissionWithAssessment);
      prisma.inlineComment.aggregate.mockResolvedValue({
        _max: { number: null },
      });
      prisma.inlineComment.create.mockResolvedValue({ id: 'pin-1', number: 1 });

      const dto: CreateAnnotationDto = {
        type: CommentType.PIN,
        x: 50,
        y: 50,
        color: '#ff0000',
      };

      await service.create(teacher, 'submission-1', dto);

      const createArg = prisma.inlineComment.create.mock.calls[0][0];
      expect(createArg.data.number).toBe(1);
    });

    it('goes through the transaction/advisory-lock path only for PIN, not STROKE/HIGHLIGHT', async () => {
      prisma.submission.findUnique.mockResolvedValue(submissionWithAssessment);
      prisma.inlineComment.create.mockResolvedValue({ id: 'stroke-1' });

      const dto: CreateAnnotationDto = {
        type: CommentType.STROKE,
        points: [
          { x: 10, y: 10 },
          { x: 20, y: 20 },
        ],
        color: '#000000',
      };

      await service.create(teacher, 'submission-1', dto);

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.inlineComment.create).toHaveBeenCalled();
    });

    it("denies a teacher who doesn't own the assessment", async () => {
      prisma.submission.findUnique.mockResolvedValue(submissionWithAssessment);
      const otherTeacher: AuthUser = {
        userId: 'teacher-2',
        role: Role.TEACHER,
      };

      await expect(
        service.create(otherTeacher, 'submission-1', {
          type: CommentType.PIN,
          x: 10,
          y: 10,
          color: '#000',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException when the submission does not exist', async () => {
      prisma.submission.findUnique.mockResolvedValue(null);

      await expect(
        service.create(teacher, 'nonexistent', {
          type: CommentType.PIN,
          x: 10,
          y: 10,
          color: '#000',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    const fullSubmission = {
      ...submissionWithAssessment,
      studentId: 'student-1',
      student: { studentLinks: [] },
    };

    it('allows the owning teacher', async () => {
      prisma.submission.findUnique.mockResolvedValue(fullSubmission);
      prisma.inlineComment.findMany.mockResolvedValue([]);

      await expect(service.findAll(teacher, 'submission-1')).resolves.toEqual(
        [],
      );
    });

    it('denies an unrelated student', async () => {
      prisma.submission.findUnique.mockResolvedValue(fullSubmission);
      const otherStudent: AuthUser = {
        userId: 'student-2',
        role: Role.STUDENT,
      };

      await expect(
        service.findAll(otherStudent, 'submission-1'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    const annotationWithSubmission = {
      id: 'annotation-1',
      submission: submissionWithAssessment,
    };

    it('deletes when the requesting teacher owns the assessment', async () => {
      prisma.inlineComment.findUnique.mockResolvedValue(
        annotationWithSubmission,
      );
      prisma.inlineComment.delete.mockResolvedValue({ id: 'annotation-1' });

      await service.remove(teacher, 'annotation-1');

      expect(prisma.inlineComment.delete).toHaveBeenCalledWith({
        where: { id: 'annotation-1' },
      });
    });

    it("denies a teacher who doesn't own the assessment", async () => {
      prisma.inlineComment.findUnique.mockResolvedValue(
        annotationWithSubmission,
      );
      const otherTeacher: AuthUser = {
        userId: 'teacher-2',
        role: Role.TEACHER,
      };

      await expect(
        service.remove(otherTeacher, 'annotation-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.inlineComment.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the annotation does not exist', async () => {
      prisma.inlineComment.findUnique.mockResolvedValue(null);

      await expect(service.remove(teacher, 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
