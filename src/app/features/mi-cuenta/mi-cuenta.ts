import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensajeDeError } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { AvisosService } from '../../core/services/avisos.service';

@Component({
  selector: 'app-mi-cuenta',
  imports: [FormsModule],
  template: `
    <div class="pagina angosta">
      <header class="encabezado">
        <div>
          <p class="antetitulo">{{ auth.currentUser()?.usuario }} · {{ auth.currentUser()?.rol }}</p>
          <h1 class="titulo">Cambiar contraseña</h1>
        </div>
      </header>
      <form class="tarjeta con-relleno formulario" style="grid-template-columns: 1fr; max-width: 420px" (ngSubmit)="guardar()">
        <div><label class="etiqueta" for="actual">Contraseña actual</label><input id="actual" name="actual" class="campo" type="password" autocomplete="current-password" [(ngModel)]="actual" /></div>
        <div><label class="etiqueta" for="nueva">Nueva contraseña</label><input id="nueva" name="nueva" class="campo" type="password" autocomplete="new-password" [(ngModel)]="nueva" /><p class="ayuda">Mínimo 8 caracteres.</p></div>
        <div><label class="etiqueta" for="repite">Repite la nueva</label><input id="repite" name="repite" class="campo" type="password" autocomplete="new-password" [(ngModel)]="repite" /></div>
        @if (nueva && repite && nueva !== repite) {<p class="negativo chico">No coinciden.</p>}
        <button type="submit" class="boton primario" [disabled]="guardando() || !actual || nueva.length < 8 || nueva !== repite">Guardar</button>
      </form>
    </div>
  `,
})
export class MiCuenta {
  protected readonly auth = inject(AuthService);
  private readonly avisos = inject(AvisosService);
  protected actual = '';
  protected nueva = '';
  protected repite = '';
  protected readonly guardando = signal(false);

  protected guardar(): void {
    this.guardando.set(true);
    this.auth.cambiarContrasena(this.actual, this.nueva).subscribe({
      next: () => {
        this.avisos.exito('Contraseña actualizada.');
        this.actual = this.nueva = this.repite = '';
        this.guardando.set(false);
      },
      error: (e) => {
        this.avisos.error(mensajeDeError(e));
        this.guardando.set(false);
      },
    });
  }
}
