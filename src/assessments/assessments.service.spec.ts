import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AssessmentType, QuestionType, Role } from '@prisma/client';
import { AssessmentsService } from './assessments.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../common/ownership';
import { CreateAssessmentDto } from './dto/create-assessment.dto';

interface MockPrisma {
  class: { findUnique: jest.Mock };
  assessment: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
  };
}

describe('AssessmentsService', () => {
  let service: AssessmentsService;
  let prisma: MockPrisma;

  beforeEach(async () => {
    prisma = {
      class: { findUnique: jest.fn() },
      assessment: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        AssessmentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AssessmentsService);
  });

  describe('create — class-ownership check', () => {
    const teacher: AuthUser = { userId: 'teacher-1', role: Role.TEACHER };
    const dto: CreateAssessmentDto = {
      title: 'Stub',
      type: AssessmentType.ASSIGNMENT,
      classId: 'class-1',
      subject: 'General',
      dueDate: new Date().toISOString(),
    };

    it('succeeds when the teacher owns the class', async () => {
      prisma.class.findUnique.mockResolvedValue({
        id: 'class-1',
        teacherId: 'teacher-1',
      });
      prisma.assessment.create.mockResolvedValue({ id: 'assessment-1' });

      await expect(service.create(teacher, dto)).resolves.toBeDefined();
      expect(prisma.assessment.create).toHaveBeenCalled();
    });

    it('throws NotFoundException when the class does not exist', async () => {
      prisma.class.findUnique.mockResolvedValue(null);

      await expect(service.create(teacher, dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.assessment.create).not.toHaveBeenCalled();
    });

    it("throws ForbiddenException when the teacher doesn't own the class", async () => {
      prisma.class.findUnique.mockResolvedValue({
        id: 'class-1',
        teacherId: 'some-other-teacher',
      });

      await expect(service.create(teacher, dto)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.assessment.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll — role-based scoping (regression guard for the fixed filter)', () => {
    it('gives admin an empty filter (sees everything)', async () => {
      await service.findAll({ userId: 'admin-1', role: Role.ADMIN });
      expect(prisma.assessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('scopes a teacher to their own class via class.teacherId', async () => {
      await service.findAll({ userId: 'teacher-1', role: Role.TEACHER });
      expect(prisma.assessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { class: { teacherId: 'teacher-1' } },
        }),
      );
    });

    it('scopes a student to their enrolled class, not class.teacherId', async () => {
      await service.findAll({ userId: 'student-1', role: Role.STUDENT });
      expect(prisma.assessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { class: { students: { some: { id: 'student-1' } } } },
        }),
      );
    });

    it("scopes a parent to their linked student's class", async () => {
      await service.findAll({ userId: 'parent-1', role: Role.PARENT });
      expect(prisma.assessment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            class: {
              students: {
                some: { studentLinks: { some: { parentId: 'parent-1' } } },
              },
            },
          },
        }),
      );
    });
  });

  describe('findOne — answer-key stripping', () => {
    const assessmentWithAnswers = {
      id: 'assessment-1',
      questions: [
        {
          id: 'q1',
          type: QuestionType.MCQ,
          text: 'What is 2+2?',
          correctAnswer: '4',
        },
      ],
    };

    it('strips correctAnswer for a student', async () => {
      prisma.assessment.findUnique.mockResolvedValue(assessmentWithAnswers);

      const result = await service.findOne(
        { userId: 'student-1', role: Role.STUDENT },
        'assessment-1',
      );

      expect(result.questions[0]).not.toHaveProperty('correctAnswer');
    });

    it('strips correctAnswer for a parent', async () => {
      prisma.assessment.findUnique.mockResolvedValue(assessmentWithAnswers);

      const result = await service.findOne(
        { userId: 'parent-1', role: Role.PARENT },
        'assessment-1',
      );

      expect(result.questions[0]).not.toHaveProperty('correctAnswer');
    });

    it('keeps correctAnswer for a teacher', async () => {
      prisma.assessment.findUnique.mockResolvedValue(assessmentWithAnswers);

      const result = await service.findOne(
        { userId: 'teacher-1', role: Role.TEACHER },
        'assessment-1',
      );

      expect(result.questions[0]).toHaveProperty('correctAnswer', '4');
    });

    it('keeps correctAnswer for admin', async () => {
      prisma.assessment.findUnique.mockResolvedValue(assessmentWithAnswers);

      const result = await service.findOne(
        { userId: 'admin-1', role: Role.ADMIN },
        'assessment-1',
      );

      expect(result.questions[0]).toHaveProperty('correctAnswer', '4');
    });

    it('throws NotFoundException when the assessment does not exist', async () => {
      prisma.assessment.findUnique.mockResolvedValue(null);

      await expect(
        service.findOne(
          { userId: 'teacher-1', role: Role.TEACHER },
          'nonexistent',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
