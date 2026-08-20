import { IsNumber, Max, Min } from 'class-validator';

// Percent-space coordinates (0-100), not pixels — a stroke's shape stays
// correct regardless of the image's render size on re-open.
export class PointDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  x: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  y: number;
}
