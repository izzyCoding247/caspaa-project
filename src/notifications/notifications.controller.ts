import { Controller, Get, Param, Patch, Request } from '@nestjs/common';
import { AuthUser } from '../common/ownership';
import { NotificationsService } from './notifications.service';

interface AuthenticatedRequest {
  user: AuthUser;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    return this.notificationsService.findAll(req.user.userId);
  }

  @Patch(':id/read')
  markAsRead(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.notificationsService.markAsRead(req.user.userId, id);
  }
}
