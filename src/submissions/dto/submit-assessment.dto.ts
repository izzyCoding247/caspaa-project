import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { SubmitAnswerDto } from './submit-answer.dto';

// Deliberately loose — which fields are actually required depends on
// assessment.type, fetched server-side, never trusted from the client.
// The service enforces the real shape after fetching the real assessment.
export class SubmitAssessmentDto {
  @IsOptional()
  @IsString()
  textContent?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  fileType?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitAnswerDto)
  answers?: SubmitAnswerDto[];
}
