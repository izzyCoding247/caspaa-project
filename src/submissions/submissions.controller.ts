import { Body, Controller, Param, Post, Request } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../common/ownership';
import { SubmissionsService } from './submissions.service';
import { SubmitAssessmentDto } from './dto/submit-assessment.dto';

interface AuthenticatedRequest {
  user: AuthUser;
}

@Controller('assessments/:assessmentId/submissions')
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Roles(Role.STUDENT)
  @Post()
  submit(
    @Request() req: AuthenticatedRequest,
    @Param('assessmentId') assessmentId: string,
    @Body() dto: SubmitAssessmentDto,
  ) {
    return this.submissionsService.submit(req.user, assessmentId, dto);
  }
}
