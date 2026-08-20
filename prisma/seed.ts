import {
  PrismaClient,
  Role,
  AssessmentType,
  QuestionType,
  CommentType,
  GradeStatus,
  NotificationType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Wipe in reverse FK order so this stub is safely rerunnable during dev.
  await prisma.notification.deleteMany();
  await prisma.grade.deleteMany();
  await prisma.inlineComment.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.question.deleteMany();
  await prisma.assessment.deleteMany();
  await prisma.parentStudentLink.deleteMany();
  await prisma.class.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 10);

  const teacher = await prisma.user.create({
    data: {
      email: 'teacher@caspaa.test',
      passwordHash,
      name: 'Stub Teacher',
      role: Role.TEACHER,
    },
  });

  await prisma.user.create({
    data: {
      email: 'admin@caspaa.test',
      passwordHash,
      name: 'Stub Admin',
      role: Role.ADMIN,
    },
  });

  const parent = await prisma.user.create({
    data: {
      email: 'parent@caspaa.test',
      passwordHash,
      name: 'Stub Parent',
      role: Role.PARENT,
    },
  });

  const klass = await prisma.class.create({
    data: { name: 'Stub Class', teacherId: teacher.id },
  });

  const student = await prisma.user.create({
    data: {
      email: 'student@caspaa.test',
      passwordHash,
      name: 'Stub Student',
      role: Role.STUDENT,
      classId: klass.id,
    },
  });

  await prisma.parentStudentLink.create({
    data: { parentId: parent.id, studentId: student.id },
  });

  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const assignment = await prisma.assessment.create({
    data: {
      title: 'Stub Assignment',
      type: AssessmentType.ASSIGNMENT,
      classId: klass.id,
      teacherId: teacher.id,
      subject: 'General',
      dueDate,
    },
  });

  const cbt = await prisma.assessment.create({
    data: {
      title: 'Stub CBT',
      type: AssessmentType.CBT,
      classId: klass.id,
      teacherId: teacher.id,
      subject: 'General',
      dueDate,
    },
  });

  const question = await prisma.question.create({
    data: {
      assessmentId: cbt.id,
      type: QuestionType.MCQ,
      text: 'Stub question?',
      options: ['A', 'B', 'C'],
      correctAnswer: 'A',
    },
  });

  const assignmentSubmission = await prisma.submission.create({
    data: {
      assessmentId: assignment.id,
      studentId: student.id,
      textContent: 'Stub answer text.',
    },
  });

  const cbtSubmission = await prisma.submission.create({
    data: {
      assessmentId: cbt.id,
      studentId: student.id,
      status: 'GRADED',
      autoScore: 1,
    },
  });

  await prisma.answer.create({
    data: {
      submissionId: cbtSubmission.id,
      questionId: question.id,
      response: 'A',
      isCorrect: true,
      autoScored: true,
    },
  });

  await prisma.inlineComment.create({
    data: {
      submissionId: assignmentSubmission.id,
      authorId: teacher.id,
      type: CommentType.PIN,
      x: 50,
      y: 50,
      color: '#ff0000',
      number: 1,
      text: 'Stub comment',
    },
  });

  await prisma.grade.create({
    data: {
      submissionId: assignmentSubmission.id,
      score: 80,
      status: GradeStatus.SATISFACTORY,
      feedback: 'Stub feedback.',
      gradedById: teacher.id,
    },
  });

  await prisma.notification.create({
    data: {
      userId: student.id,
      type: NotificationType.SUBMITTED,
      payload: { assessmentId: assignment.id },
    },
  });

  console.log('Seed stub complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
