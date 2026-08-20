import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(
    userId: string,
    type: NotificationType,
    payload: Prisma.InputJsonValue,
  ) {
    return this.prisma.notification.create({
      data: { userId, type, payload },
    });
  }

  findAll(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async markAsRead(userId: string, notificationId: string) {
    const notification = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) {
      throw new NotFoundException('Notification not found.');
    }

    // Deliberately a plain equality check, not the ownership-helper
    // pattern used elsewhere — a notification's ownership is a single
    // direct field, and it's personal (no admin oversight bypass, unlike
    // assessments/submissions).
    if (notification.userId !== userId) {
      throw new ForbiddenException('This notification does not belong to you.');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  }
}
