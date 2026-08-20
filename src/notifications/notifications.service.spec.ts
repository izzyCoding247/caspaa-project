import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';

interface MockPrisma {
  notification: {
    create: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: MockPrisma;

  beforeEach(async () => {
    prisma = {
      notification: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('findAll', () => {
    it('scopes the query to the given userId', async () => {
      await service.findAll('user-1');

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });
  });

  describe('markAsRead', () => {
    it('marks the notification read when the caller is the recipient', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
      });
      prisma.notification.update.mockResolvedValue({
        id: 'notif-1',
        read: true,
      });

      await service.markAsRead('user-1', 'notif-1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'notif-1' },
        data: { read: true },
      });
    });

    it("rejects a caller who isn't the recipient", async () => {
      prisma.notification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
      });

      await expect(
        service.markAsRead('someone-else', 'notif-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.notification.update).not.toHaveBeenCalled();
    });

    it('rejects admin too — a notification is personal, no oversight bypass', async () => {
      prisma.notification.findUnique.mockResolvedValue({
        id: 'notif-1',
        userId: 'user-1',
      });

      // Note: markAsRead takes a plain userId, not an AuthUser with a role —
      // there is no role-based bypass path to even test around. Any userId
      // that isn't the recipient's is rejected, admin included.
      await expect(service.markAsRead('admin-1', 'notif-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('throws NotFoundException when the notification does not exist', async () => {
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.markAsRead('user-1', 'nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('creates a notification with the given fields', async () => {
      prisma.notification.create.mockResolvedValue({ id: 'notif-1' });

      await service.create('user-1', NotificationType.SUBMITTED, {
        submissionId: 'submission-1',
      });

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          type: NotificationType.SUBMITTED,
          payload: { submissionId: 'submission-1' },
        },
      });
    });
  });
});
