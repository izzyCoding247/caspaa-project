import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Request,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../common/ownership';
import { InlineCommentsService } from './inline-comments.service';
import { CreateAnnotationDto } from './dto/create-annotation.dto';

interface AuthenticatedRequest {
  user: AuthUser;
}

@Controller()
export class InlineCommentsController {
  constructor(private readonly inlineCommentsService: InlineCommentsService) {}

  // Create/delete are teacher-only — a student/parent should never be able
  // to add marking annotations, only view them (see findAll below).
  @Roles(Role.TEACHER)
  @Post('submissions/:submissionId/annotations')
  create(
    @Request() req: AuthenticatedRequest,
    @Param('submissionId') submissionId: string,
    @Body() dto: CreateAnnotationDto,
  ) {
    return this.inlineCommentsService.create(req.user, submissionId, dto);
  }

  // No @Roles() — open to any authenticated role; assertCanViewSubmission
  // inside the service does the real scoping (teacher/student/parent/admin).
  @Get('submissions/:submissionId/annotations')
  findAll(
    @Request() req: AuthenticatedRequest,
    @Param('submissionId') submissionId: string,
  ) {
    return this.inlineCommentsService.findAll(req.user, submissionId);
  }

  @Roles(Role.TEACHER)
  @Delete('annotations/:id')
  remove(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.inlineCommentsService.remove(req.user, id);
  }
}
