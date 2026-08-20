import { Controller, Post, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request as ExpressRequest } from 'express';
import { Role } from '@prisma/client';
import { Public } from './decorators/public.decorator';
import { AuthService } from './auth.service';

interface LoginRequest extends ExpressRequest {
  user: { id: string; role: Role };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseGuards(AuthGuard('local'))
  @Post('login')
  login(@Request() req: LoginRequest) {
    return this.authService.login(req.user);
  }
}
