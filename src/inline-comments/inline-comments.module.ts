import { Module } from '@nestjs/common';
import { InlineCommentsController } from './inline-comments.controller';
import { InlineCommentsService } from './inline-comments.service';

@Module({
  controllers: [InlineCommentsController],
  providers: [InlineCommentsService],
})
export class InlineCommentsModule {}
