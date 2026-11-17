import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, mensajeDeError } from '../../../core/services/api.service';
import { AvisosService } from '../../../core/services/avisos.service';
import { ContextoService } from '../../../core/services/contexto.service';
import { Icono } from '../../../shared/icono/icono';

/** Alta de empleado. Junta lo que en el sistema anterior se repartía entre la captura quincenal y 1DATOS-P.W. */
@Component({
  selector: 'app-nuevo-empleado',
  imports: [FormsModule, RouterLink, Icono],
  templateUrl: './nuevo.html',
})
export class NuevoEmpleado {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly avisos = inject(AvisosService);
  protected readonly contexto = inject(ContextoService);

  protected readonly guardando = signal(false);
  protected readonly errores = signal<string[]>([]);
  protected readonly datos = {
    curp: '',
    rfc: '',
    apellidoPaterno: '',
    apellidoMaterno: '',
    nombres: '',
    tipoNomina: this.contexto.tipoNomina(),
    adscripcionId: null as number | null,
    puestoClave: '',
    nivel: null as number | null,
    rango: 1,
    fechaAlta: new Date().toISOString().slice(0, 10),
    numeroIssemym: null as number | null,
    sindicalizado: false,
    sci: false,
    fechaNacimiento: '',
    fechaIngresoGobierno: '',
    codigoPostalFiscal: '',
    banco: 'CITIBANAMEX',
    cuentaBancaria: '',
    pagoCheque: false,
    sexo: '',
    correo: '',
    telefono: '',
  };

  /** El RFC sale de los primeros 10 caracteres de la CURP; solo falta la homoclave. */
  protected curpCambio(valor: string): void {
    this.datos.curp = valor.toUpperCase();
    if (!this.datos.rfc && valor.length >= 10) this.datos.rfc = valor.slice(0, 10).toUpperCase();
    if (valor.length >= 11 && !this.datos.sexo) this.datos.sexo = valor[10]?.toUpperCase() === 'M' ? 'M' : 'H';
  }

  protected guardar(): void {
    if (this.guardando()) return;
    this.guardando.set(true);
    this.errores.set([]);
    const { sexo, correo, telefono, ...d } = this.datos;
    const limpio = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '' && v !== null));
    this.api.crearEmpleado({ ...limpio, datosPersonales: { sexo, correo, telefono } }).subscribe({
      next: ({ id }) => {
        this.avisos.exito('Empleado dado de alta.');
        void this.router.navigate(['/empleados', id]);
      },
      error: (e) => {
        this.errores.set(mensajeDeError(e).split('. '));
        this.guardando.set(false);
      },
    });
  }
}
