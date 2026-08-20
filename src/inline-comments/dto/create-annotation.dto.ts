import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CommentType } from '@prisma/client';
import { PointDto } from './point.dto';

export class CreateAnnotationDto {
  @IsEnum(CommentType)
  type: CommentType;

  @ValidateIf(
    (dto: CreateAnnotationDto) =>
      dto.type === CommentType.PIN || dto.type === CommentType.HIGHLIGHT,
  )
  @IsNumber()
  @Min(0)
  @Max(100)
  x?: number;

  @ValidateIf(
    (dto: CreateAnnotationDto) =>
      dto.type === CommentType.PIN || dto.type === CommentType.HIGHLIGHT,
  )
  @IsNumber()
  @Min(0)
  @Max(100)
  y?: number;

  @ValidateIf((dto: CreateAnnotationDto) => dto.type === CommentType.HIGHLIGHT)
  @IsNumber()
  @Min(0)
  @Max(100)
  width?: number;

  @ValidateIf((dto: CreateAnnotationDto) => dto.type === CommentType.HIGHLIGHT)
  @IsNumber()
  @Min(0)
  @Max(100)
  height?: number;

  @ValidateIf((dto: CreateAnnotationDto) => dto.type === CommentType.STROKE)
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => PointDto)
  points?: PointDto[];

  @IsString()
  color: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  strokeWidth?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsString()
  text?: string;
}
