import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../common/ownership';
import { SubmissionsService } from './submissions.service';
import { SubmitAssessmentDto } from './dto/submit-assessment.dto';
import { GradeSubmissionDto } from './dto/grade-submission.dto';

interface AuthenticatedRequest {
  user: AuthUser;
}

// No class-level prefix: submit lives under /assessments/:assessmentId/
// submissions, while grade/return/resubmit/findOne live under
// /submissions/:id/... — two different path shapes, so each route
// declares its own full path.
@Controller()
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Roles(Role.STUDENT)
  @Post('assessments/:assessmentId/submissions')
  submit(
    @Request() req: AuthenticatedRequest,
    @Param('assessmentId') assessmentId: string,
    @Body() dto: SubmitAssessmentDto,
  ) {
    return this.submissionsService.submit(req.user, assessmentId, dto);
  }

  // No @Roles() — open to any authenticated role; assertCanViewSubmission
  // inside the service does the real scoping (teacher/student/parent/admin).
  @Get('submissions/:id')
  findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.submissionsService.findOne(req.user, id);
  }

  @Roles(Role.TEACHER)
  @Patch('submissions/:id/grade')
  grade(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: GradeSubmissionDto,
  ) {
    return this.submissionsService.grade(req.user, id, dto);
  }

  @Roles(Role.TEACHER)
  @Post('submissions/:id/return')
  returnSubmission(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.submissionsService.return(req.user, id);
  }

  @Roles(Role.STUDENT)
  @Post('submissions/:id/resubmit')
  resubmit(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: SubmitAssessmentDto,
  ) {
    return this.submissionsService.resubmit(req.user, id, dto);
  }
}
