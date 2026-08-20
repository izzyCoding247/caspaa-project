import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AssessmentType,
  GradeStatus,
  QuestionType,
  Role,
  SubmissionStatus,
} from '@prisma/client';
import { SubmissionsService } from './submissions.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthUser } from '../common/ownership';
import { SubmitAssessmentDto } from './dto/submit-assessment.dto';

interface SubmissionCreateArg {
  data: {
    status: SubmissionStatus;
    autoScore?: number;
    grade?: { create: { score: number; gradedById: null } };
  };
}

interface GradeUpsertArg {
  create: { score: number };
}

interface SubmissionUpdateArg {
  data: { status: SubmissionStatus; returnedAt?: Date };
}

function newSubmissionCreateMock() {
  return jest.fn<Promise<{ id: string }>, [SubmissionCreateArg]>();
}

function newSubmissionUpdateMock() {
  return jest.fn<Promise<{ id: string }>, [SubmissionUpdateArg]>();
}

interface MockPrisma {
  assessment: { findUnique: jest.Mock };
  user: { findUnique: jest.Mock };
  submission: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock<Promise<{ id: string }>, [SubmissionCreateArg]>;
    update: jest.Mock<Promise<{ id: string }>, [SubmissionUpdateArg]>;
  };
  grade: { upsert: jest.Mock<Promise<{ id: string }>, [GradeUpsertArg]> };
}

interface MockNotificationsService {
  create: jest.Mock;
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
        findUnique: jest.fn(),
        create: newSubmissionCreateMock().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'submission-1', ...data }),
        ),
        update: newSubmissionUpdateMock(),
      },
      grade: { upsert: jest.fn<Promise<{ id: string }>, [GradeUpsertArg]>() },
    };
    prisma.user.findUnique.mockResolvedValue({ id: 'student-1', classId });

    const notifications: MockNotificationsService = { create: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
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

describe('SubmissionsService.grade', () => {
  let service: SubmissionsService;
  let prisma: MockPrisma;
  const teacherId = 'teacher-1';
  const teacher: AuthUser = { userId: teacherId, role: Role.TEACHER };

  const submissionWithAssessment = {
    id: 'submission-1',
    autoScore: null as number | null,
    assessment: { id: 'assessment-1', class: { teacherId } },
  };

  beforeEach(async () => {
    prisma = {
      assessment: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      submission: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: newSubmissionCreateMock(),
        update: newSubmissionUpdateMock(),
      },
      grade: {
        upsert: jest
          .fn<Promise<{ id: string }>, [GradeUpsertArg]>()
          .mockResolvedValue({ id: 'grade-1' }),
      },
    };

    const notifications: MockNotificationsService = { create: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(SubmissionsService);
  });

  it('uses dto.score directly when there is no autoScore (plain assignment)', async () => {
    prisma.submission.findUnique.mockResolvedValue({
      ...submissionWithAssessment,
      autoScore: null,
    });

    await service.grade(teacher, 'submission-1', {
      score: 80,
      status: GradeStatus.SATISFACTORY,
    });

    const arg = prisma.grade.upsert.mock.calls[0][0];
    expect(arg.create.score).toBe(80);
  });

  it('folds the entered score into an existing autoScore', async () => {
    prisma.submission.findUnique.mockResolvedValue({
      ...submissionWithAssessment,
      autoScore: 1,
    });

    await service.grade(teacher, 'submission-1', {
      score: 5,
      status: GradeStatus.EXCELLENT,
    });

    const arg = prisma.grade.upsert.mock.calls[0][0];
    expect(arg.create.score).toBe(6);
  });

  it('upserts rather than failing on a second save', async () => {
    prisma.submission.findUnique.mockResolvedValue(submissionWithAssessment);

    await service.grade(teacher, 'submission-1', {
      score: 10,
      status: GradeStatus.SATISFACTORY,
    });
    await service.grade(teacher, 'submission-1', {
      score: 20,
      status: GradeStatus.EXCELLENT,
    });

    expect(prisma.grade.upsert).toHaveBeenCalledTimes(2);
  });

  it("denies a teacher who doesn't own the assessment", async () => {
    prisma.submission.findUnique.mockResolvedValue(submissionWithAssessment);
    const otherTeacher: AuthUser = { userId: 'teacher-2', role: Role.TEACHER };

    await expect(
      service.grade(otherTeacher, 'submission-1', {
        score: 5,
        status: GradeStatus.EXCELLENT,
      }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('SubmissionsService.return', () => {
  let service: SubmissionsService;
  let prisma: MockPrisma;
  let notifications: MockNotificationsService;
  const teacherId = 'teacher-1';
  const teacher: AuthUser = { userId: teacherId, role: Role.TEACHER };

  const baseSubmission = {
    id: 'submission-1',
    assessmentId: 'assessment-1',
    studentId: 'student-1',
    assessment: { id: 'assessment-1', class: { teacherId } },
    student: {
      studentLinks: [
        { parentId: 'parent-1', studentId: 'student-1' },
        { parentId: 'parent-2', studentId: 'student-1' },
      ],
    },
  };

  beforeEach(async () => {
    prisma = {
      assessment: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      submission: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: newSubmissionCreateMock(),
        update: newSubmissionUpdateMock().mockResolvedValue({
          id: 'submission-1',
        }),
      },
      grade: { upsert: jest.fn<Promise<{ id: string }>, [GradeUpsertArg]>() },
    };
    notifications = { create: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SubmissionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(SubmissionsService);
  });

  it('rejects returning a submission with no grade yet', async () => {
    prisma.submission.findUnique.mockResolvedValue({
      ...baseSubmission,
      grade: null,
    });

    await expect(service.return(teacher, 'submission-1')).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.submission.update).not.toHaveBeenCalled();
  });

  it('sets status RETURNED and notifies the student plus every linked parent', async () => {
    prisma.submission.findUnique.mockResolvedValue({
      ...baseSubmission,
      grade: { score: 90 },
    });

    await service.return(teacher, 'submission-1');

    const updateArg = prisma.submission.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe(SubmissionStatus.RETURNED);
    // student + 2 linked parents = 3 notifications
    expect(notifications.create).toHaveBeenCalledTimes(3);
    expect(notifications.create).toHaveBeenCalledWith(
      'student-1',
      'RETURNED',
      expect.anything(),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'parent-1',
      'RETURNED',
      expect.anything(),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      'parent-2',
      'RETURNED',
      expect.anything(),
    );
  });

  it("denies a teacher who doesn't own the assessment", async () => {
    prisma.submission.findUnique.mockResolvedValue({
      ...baseSubmission,
      grade: { score: 90 },
    });
    const otherTeacher: AuthUser = { userId: 'teacher-2', role: Role.TEACHER };

    await expect(service.return(otherTeacher, 'submission-1')).rejects.toThrow(
      ForbiddenException,
    );
  });
});
