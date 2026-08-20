import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AssessmentType } from '@prisma/client';
import { CreateQuestionDto } from './create-question.dto';

export class CreateAssessmentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(AssessmentType)
  type: AssessmentType;

  @IsOptional()
  @IsBoolean()
  isQuickTest?: boolean;

  @IsString()
  @IsNotEmpty()
  classId: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsOptional()
  @IsString()
  attachment?: string;

  // Deliberately unvalidated shape — rubric stays a loose Json blob
  // (Phase 1 decision), not a structure worth enforcing here.
  @IsOptional()
  rubric?: unknown;

  @IsISO8601()
  dueDate: string;

  @ValidateIf((dto: CreateAssessmentDto) => dto.type === AssessmentType.CBT)
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateQuestionDto)
  questions?: CreateQuestionDto[];
}
