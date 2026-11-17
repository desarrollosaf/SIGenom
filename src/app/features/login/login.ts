import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Viene en la URL cuando la sesión terminó sola: "sesion" o "inactividad". */
  readonly motivo = input<string>();

  protected readonly usuario = signal('');
  protected readonly contrasena = signal('');
  protected readonly verContrasena = signal(false);
  protected readonly enviando = signal(false);
  protected readonly error = signal('');

  /** Lo que en el sistema anterior eran siete menús, como muestra de lo que hay adentro. */
  protected readonly ciclo = ['Captura', 'Prenómina', 'Verificación', 'Nómina', 'Dispersión', 'Cierre'];

  protected entrar(): void {
    if (!this.usuario().trim() || !this.contrasena() || this.enviando()) return;
    this.enviando.set(true);
    this.error.set('');
    this.auth.login(this.usuario(), this.contrasena()).subscribe({
      next: () => void this.router.navigate(['/inicio']),
      error: (error) => {
        this.error.set(mensajeDeError(error));
        this.enviando.set(false);
      },
    });
  }
}
