import { Body, Controller, Get, Param, Post, Request } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthUser } from '../common/ownership';
import { AssessmentsService } from './assessments.service';
import { CreateAssessmentDto } from './dto/create-assessment.dto';

interface AuthenticatedRequest {
  user: AuthUser;
}

@Controller('assessments')
export class AssessmentsController {
  constructor(private readonly assessmentsService: AssessmentsService) {}

  @Roles(Role.TEACHER)
  @Post()
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateAssessmentDto,
  ) {
    return this.assessmentsService.create(req.user, dto);
  }

  @Get()
  findAll(@Request() req: AuthenticatedRequest) {
    return this.assessmentsService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Request() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.assessmentsService.findOne(req.user, id);
  }
}
