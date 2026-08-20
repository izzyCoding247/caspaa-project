import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SubmitAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  @IsOptional()
  @IsString()
  response?: string;
}
