import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, mensajeDeError } from '../../core/services/api.service';
import { AvisosService } from '../../core/services/avisos.service';
import type { UsuarioSistema } from '../../core/services/modelos';
import { Cajon } from '../../shared/cajon/cajon';
import { FORMATO } from '../../shared/formato';
import { Icono } from '../../shared/icono/icono';

/** Usuarios y roles. Sustituye a las contraseñas por menú que pedía PASSWORD.P. */
@Component({
  selector: 'app-usuarios',
  imports: [FormsModule, Icono, Cajon, ...FORMATO],
  template: `
    <div class="pagina">
      <header class="encabezado">
        <div>
          <p class="antetitulo">Configuración</p>
          <h1 class="titulo">Usuarios</h1>
          <p class="apagado">Administrador: todo. Nominista: captura, cálculo, catálogos y reportes. Consulta: solo ver y reportes.</p>
        </div>
        <button type="button" class="boton primario" (click)="abrir()"><app-icono nombre="mas" [tamano]="16" />Nuevo usuario</button>
      </header>

      <div class="tabla-marco">
        <table class="tabla">
          <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Último acceso</th><th>Estado</th></tr></thead>
          <tbody>
            @for (u of usuarios(); track u.id) {
              <tr class="clic" (click)="abrir(u)">
                <td class="mono principal">{{ u.usuario }}</td>
                <td>{{ u.nombre }}</td>
                <td>{{ nombreRol(u.rol) }}</td>
                <td class="chico tenue">{{ u.ultimoAcceso ? (u.ultimoAcceso | fecha: true) : 'Nunca' }}</td>
                <td><span class="insignia" [class.verde]="u.activo">{{ u.activo ? 'Activo' : 'Inactivo' }}</span></td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <app-cajon [abierto]="!!forma()" [titulo]="forma()?.id ? 'Editar usuario' : 'Nuevo usuario'" (cerrar)="forma.set(null)">
        @if (forma(); as f) {
          <div class="formulario" style="grid-template-columns: 1fr">
            <div><label class="etiqueta">Usuario</label><input class="campo mono" [(ngModel)]="f.usuario" [readonly]="!!f.id" /></div>
            <div><label class="etiqueta">Nombre</label><input class="campo" [(ngModel)]="f.nombre" /></div>
            <div>
              <label class="etiqueta">Rol</label>
              <select class="campo" [(ngModel)]="f.rol">@for (r of roles(); track r.clave) {<option [value]="r.clave">{{ r.nombre }}</option>}</select>
            </div>
            <div>
              <label class="etiqueta">{{ f.id ? 'Nueva contraseña (opcional)' : 'Contraseña' }}</label>
              <input class="campo" type="password" autocomplete="new-password" [(ngModel)]="f.password" />
              <p class="ayuda">Mínimo 8 caracteres.</p>
            </div>
            @if (f.id) {<label class="casilla"><input type="checkbox" [(ngModel)]="f.activo" />Activo</label>}
          </div>
        }
        <ng-container pie>
          <button type="button" class="boton" (click)="forma.set(null)">Cancelar</button>
          <button type="button" class="boton primario" (click)="guardar()">Guardar</button>
        </ng-container>
      </app-cajon>
    </div>
  `,
})
export class Usuarios {
  private readonly api = inject(ApiService);
  private readonly avisos = inject(AvisosService);
  protected readonly usuarios = signal<UsuarioSistema[]>([]);
  protected readonly roles = signal<{ clave: string; nombre: string }[]>([]);
  protected readonly forma = signal<{ id?: number; usuario: string; nombre: string; rol: string; password: string; activo: boolean } | null>(null);

  constructor() {
    this.cargar();
  }

  private cargar(): void {
    this.api.usuarios().subscribe((r) => {
      this.usuarios.set(r.usuarios);
      this.roles.set(r.roles);
    });
  }

  protected nombreRol(clave: string): string {
    return this.roles().find((r) => r.clave === clave)?.nombre ?? clave;
  }

  protected abrir(u?: UsuarioSistema): void {
    this.forma.set(u ? { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, password: '', activo: u.activo } : { usuario: '', nombre: '', rol: 'nominista', password: '', activo: true });
  }

  protected guardar(): void {
    const f = this.forma()!;
    const peticion = f.id
      ? this.api.editarUsuario(f.id, { nombre: f.nombre, rol: f.rol, activo: f.activo, ...(f.password ? { password: f.password } : {}) })
      : this.api.crearUsuario({ usuario: f.usuario, nombre: f.nombre, rol: f.rol, password: f.password });
    peticion.subscribe({
      next: () => {
        this.avisos.exito('Usuario guardado.');
        this.forma.set(null);
        this.cargar();
      },
      error: (e) => this.avisos.error(mensajeDeError(e)),
    });
  }
}
