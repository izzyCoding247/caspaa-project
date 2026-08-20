import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AssessmentType,
  QuestionType,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { SubmissionsService } from './submissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/ownership';
import { SubmitAssessmentDto } from './dto/submit-assessment.dto';

interface SubmissionCreateArg {
  data: {
    status: SubmissionStatus;
    autoScore?: number;
    grade?: { create: { score: number; gradedById: null } };
  };
}

interface MockPrisma {
  assessment: { findUnique: jest.Mock };
  user: { findUnique: jest.Mock };
  submission: {
    findFirst: jest.Mock;
    create: jest.Mock<Promise<{ id: string }>, [SubmissionCreateArg]>;
  };
}

describe('SubmissionsService.submit', () => {
  let service: SubmissionsService;
  let prisma: MockPrisma;

  const student: AuthUser = { userId: 'student-1', role: Role.STUDENT };
  const classId = 'class-1';
  const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const assignment = {
    id: 'assessment-assignment',
    type: AssessmentType.ASSIGNMENT,
    isQuickTest: false,
    classId,
    dueDate: futureDate,
    questions: [],
  };

  const mcqQuestion = {
    id: 'q1',
    type: QuestionType.MCQ,
    correctAnswer: 'B',
  };
  const trueFalseQuestion = {
    id: 'q2',
    type: QuestionType.TRUE_FALSE,
    correctAnswer: 'true',
  };
  const shortAnswerQuestion = {
    id: 'q3',
    type: QuestionType.SHORT_ANSWER,
    correctAnswer: null,
  };

  const pureCbt = {
    id: 'assessment-cbt-pure',
    type: AssessmentType.CBT,
    isQuickTest: false,
    classId,
    dueDate: futureDate,
    questions: [mcqQuestion, trueFalseQuestion],
  };

  const mixedCbt = {
    id: 'assessment-cbt-mixed',
    type: AssessmentType.CBT,
    isQuickTest: false,
    classId,
    dueDate: futureDate,
    questions: [mcqQuestion, shortAnswerQuestion],
  };

  const quickTest = {
    id: 'assessment-quick-test',
    type: AssessmentType.CBT,
    isQuickTest: true,
    classId,
    dueDate: futureDate,
    questions: [mcqQuestion, trueFalseQuestion],
  };

  beforeEach(async () => {
    prisma = {
      assessment: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      submission: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn<Promise<{ id: string }>, [SubmissionCreateArg]>()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'submission-1', ...data }),
          ),
      },
    };
    prisma.user.findUnique.mockResolvedValue({ id: 'student-1', classId });

    const module = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(SubmissionsService);
  });

  it('throws NotFoundException when the assessment does not exist', async () => {
    prisma.assessment.findUnique.mockResolvedValue(null);
    await expect(service.submit(student, 'nonexistent', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it("throws ForbiddenException when the student isn't in the assessment's class", async () => {
    prisma.assessment.findUnique.mockResolvedValue(assignment);
    prisma.user.findUnique.mockResolvedValue({
      id: 'student-1',
      classId: 'a-different-class',
    });

    await expect(
      service.submit(student, assignment.id, { textContent: 'hi' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ConflictException when a submission already exists', async () => {
    prisma.assessment.findUnique.mockResolvedValue(assignment);
    prisma.submission.findFirst.mockResolvedValue({ id: 'existing' });

    await expect(
      service.submit(student, assignment.id, { textContent: 'hi' }),
    ).rejects.toThrow(ConflictException);
  });

  it('rejects an overdue CBT submission', async () => {
    prisma.assessment.findUnique.mockResolvedValue({
      ...pureCbt,
      dueDate: pastDate,
    });

    await expect(
      service.submit(student, pureCbt.id, {
        answers: [{ questionId: 'q1', response: 'B' }],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows an overdue ASSIGNMENT submission — overdue only blocks auto-graded types', async () => {
    prisma.assessment.findUnique.mockResolvedValue({
      ...assignment,
      dueDate: pastDate,
    });

    await expect(
      service.submit(student, assignment.id, { textContent: 'late but fine' }),
    ).resolves.toBeDefined();
  });

  it('rejects a CBT submission with no answers field at all', async () => {
    prisma.assessment.findUnique.mockResolvedValue(pureCbt);
    await expect(service.submit(student, pureCbt.id, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects an answer referencing a question that isn't on this assessment", async () => {
    prisma.assessment.findUnique.mockResolvedValue(pureCbt);
    const dto: SubmitAssessmentDto = {
      answers: [{ questionId: 'question-from-another-assessment' }],
    };
    await expect(service.submit(student, pureCbt.id, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an ASSIGNMENT submission that includes an answers array', async () => {
    prisma.assessment.findUnique.mockResolvedValue(assignment);
    const dto: SubmitAssessmentDto = {
      answers: [{ questionId: 'q1' }],
    };
    await expect(service.submit(student, assignment.id, dto)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an ASSIGNMENT submission with neither text nor file', async () => {
    prisma.assessment.findUnique.mockResolvedValue(assignment);
    await expect(service.submit(student, assignment.id, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('grades a pure MCQ/TRUE_FALSE CBT immediately with the correct summed score', async () => {
    prisma.assessment.findUnique.mockResolvedValue(pureCbt);
    const dto: SubmitAssessmentDto = {
      answers: [
        { questionId: 'q1', response: 'B' }, // correct
        { questionId: 'q2', response: 'false' }, // wrong (correctAnswer is 'true')
      ],
    };

    await service.submit(student, pureCbt.id, dto);

    const createArg = prisma.submission.create.mock.calls[0][0];
    expect(createArg.data.status).toBe(SubmissionStatus.GRADED);
    expect(createArg.data.autoScore).toBe(1);
    expect(createArg.data.grade?.create).toEqual({
      score: 1,
      gradedById: null,
    });
  });

  it('leaves a mixed CBT PENDING_REVIEW with autoScore populated and no grade created', async () => {
    prisma.assessment.findUnique.mockResolvedValue(mixedCbt);
    const dto: SubmitAssessmentDto = {
      answers: [
        { questionId: 'q1', response: 'B' }, // correct MCQ
        { questionId: 'q3', response: 'a written answer' }, // short answer
      ],
    };

    await service.submit(student, mixedCbt.id, dto);

    const createArg = prisma.submission.create.mock.calls[0][0];
    expect(createArg.data.status).toBe(SubmissionStatus.PENDING_REVIEW);
    expect(createArg.data.autoScore).toBe(1);
    expect(createArg.data.grade).toBeUndefined();
  });

  it('a quick test inherits CBT auto-grade behavior with no special-case branch', async () => {
    prisma.assessment.findUnique.mockResolvedValue(quickTest);
    const dto: SubmitAssessmentDto = {
      answers: [
        { questionId: 'q1', response: 'B' },
        { questionId: 'q2', response: 'true' },
      ],
    };

    await service.submit(student, quickTest.id, dto);

    const createArg = prisma.submission.create.mock.calls[0][0];
    expect(createArg.data.status).toBe(SubmissionStatus.GRADED);
    expect(createArg.data.autoScore).toBe(2);
  });

  it('a quick test is blocked when overdue, same as a regular CBT', async () => {
    prisma.assessment.findUnique.mockResolvedValue({
      ...quickTest,
      dueDate: pastDate,
    });

    await expect(
      service.submit(student, quickTest.id, {
        answers: [{ questionId: 'q1', response: 'B' }],
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});
