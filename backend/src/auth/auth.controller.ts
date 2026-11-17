import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { Usuario, type UsuarioActual } from '../common/usuario-actual';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

class CambiarContrasenaDto {
  @IsString()
  actual: string;

  @IsString()
  @MinLength(8)
  nueva: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.usuario, dto.password);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Usuario() usuario: UsuarioActual) {
    return this.auth.yo(usuario);
  }

  @Put('contrasena')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  cambiar(@Usuario() usuario: UsuarioActual, @Body() dto: CambiarContrasenaDto) {
    return this.auth.cambiarContrasena(usuario, dto.actual, dto.nueva);
  }
}
