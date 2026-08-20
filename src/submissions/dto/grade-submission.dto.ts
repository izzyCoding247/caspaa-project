import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { GradeStatus } from '@prisma/client';

export class GradeSubmissionDto {
  // The teacher's manual component — added to any existing autoScore, not
  // the full final score. For a plain assignment (no autoScore), this
  // effectively becomes the full score.
  @IsInt()
  @Min(0)
  score: number;

  @IsEnum(GradeStatus)
  status: GradeStatus;

  @IsOptional()
  @IsString()
  feedback?: string;
}
