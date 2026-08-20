import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import { QuestionType } from '@prisma/client';

export class CreateQuestionDto {
  @IsEnum(QuestionType)
  type: QuestionType;

  @IsString()
  @IsNotEmpty()
  text: string;

  @IsOptional()
  @IsArray()
  options?: string[];

  // Required for MCQ/TRUE_FALSE (auto-graded); optional for SHORT_ANSWER
  // (teacher-marked, no value to auto-compare against).
  @ValidateIf(
    (dto: CreateQuestionDto) =>
      dto.type === QuestionType.MCQ || dto.type === QuestionType.TRUE_FALSE,
  )
  @IsString()
  @IsNotEmpty()
  correctAnswer?: string;
}
