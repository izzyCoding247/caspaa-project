import { Injectable } from '@nestjs/common';
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
}
