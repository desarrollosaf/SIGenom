import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { abrirArchivo } from '../../core/services/descarga';
import { NOMBRE_CALCULO, type ReciboDetalle } from '../../core/services/modelos';
import { FORMATO } from '../formato';
import { Icono } from '../icono/icono';

/** El recibo de un empleado tal como se calculó; se usa en Cálculo y en la ficha del empleado. */
@Component({
  selector: 'app-recibo',
  imports: [RouterLink, Icono, ...FORMATO],
  template: `
    @if (recibo(); as r) {
      <div class="cabeza">
        <div>
          <a class="nombre" [routerLink]="['/empleados', r.empleadoId]">{{ r.nombre }}</a>
          <p class="mono tenue chico">{{ r.curp }} · {{ r.rfc }}</p>
          <p class="apagado chico">{{ r.periodo.nombre }} · {{ nombres[r.calculo.tipo] }}</p>
        </div>
        <button type="button" class="boton chico" (click)="pdf(r.id)"><app-icono nombre="pdf" [tamano]="15" />PDF</button>
      </div>

      <dl class="datos compactos">
        <div><dt>Adscripción</dt><dd>{{ r.adscripcion }}</dd></div>
        <div><dt>Puesto</dt><dd>{{ r.puesto }}</dd></div>
        <div><dt>Nivel / rango</dt><dd class="mono">{{ r.nivel }} / {{ r.rango }}</dd></div>
        <div><dt>Días pagados</dt><dd class="mono">{{ r.dias }}</dd></div>
      </dl>

      @for (o of r.observaciones; track o) {
        <p class="nota ambar chico">{{ o }}</p>
      }

      <div class="columnas">
        @for (lado of lados; track lado.clave) {
          <div>
            <p class="antetitulo">{{ lado.titulo }}</p>
            <table class="tabla">
              <tbody>
                @for (c of porNaturaleza()[lado.clave]; track c.clave) {
                  <tr>
                    <td class="min mono tenue">{{ c.clave.toString().padStart(3, '0') }}</td>
                    <td class="min mono tenue" title="Clave GEM">{{ c.claveGem ? c.claveGem.toString().padStart(4, '0') : '····' }}</td>
                    <td>{{ c.descripcion }}</td>
                    <td class="der cifra">{{ c.importe | moneda }}</td>
                  </tr>
                } @empty {
                  <tr><td class="tenue" colspan="4">Sin conceptos</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>

      <div class="totales">
        <div><span class="antetitulo">Percepciones</span><span class="cifra">{{ r.totalPercepciones | moneda }}</span></div>
        <div><span class="antetitulo">Deducciones</span><span class="cifra">{{ r.totalDeducciones | moneda }}</span></div>
        <div class="neto"><span class="antetitulo">Neto</span><span class="cifra" [class.negativo]="r.neto < 0">{{ r.neto | moneda }}</span></div>
      </div>
      <p class="tenue chico pie">
        Base ISR {{ r.baseIsr | moneda }} · ISR causado {{ r.isrCausado | moneda }} · subsidio {{ r.subsidio | moneda }} ·
        base ISSEMYM {{ r.baseIssemym | moneda }} ·
        {{ r.pagoCheque ? 'pago con cheque' : r.cuentaBancaria ? 'depósito a ' + r.cuentaBancaria : 'sin cuenta bancaria' }}
      </p>
    } @else {
      <div class="esqueleto" style="height: 80px"></div>
      <div class="esqueleto" style="height: 220px"></div>
    }
  `,
  styles: `
    .cabeza {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    .nombre {
      font-size: 1.0625rem;
      font-weight: 600;
      text-decoration: none;
    }
    .nombre:hover {
      color: var(--acento);
    }
    .compactos {
      margin-bottom: 16px;
      padding: 12px 0;
      border-top: 1px solid var(--linea);
      border-bottom: 1px solid var(--linea);
    }
    .nota {
      margin-bottom: 8px;
    }
    .columnas {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      margin-top: 8px;
    }
    .columnas .antetitulo {
      margin-bottom: 4px;
    }
    .columnas td {
      padding: 7px 4px;
    }
    .totales {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      margin-top: 16px;
      border: 1px solid var(--linea);
      border-radius: 9px;
    }
    .totales div {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 14px;
      border-right: 1px solid var(--linea);
    }
    .totales div:last-child {
      border-right: 0;
    }
    .totales .cifra {
      font-size: 1.0625rem;
    }
    .neto .cifra {
      color: var(--acento);
      font-weight: 600;
    }
    .pie {
      margin-top: 10px;
    }
  `,
})
export class Recibo {
  private readonly api = inject(ApiService);
  readonly reciboId = input.required<number>();
  protected readonly recibo = signal<ReciboDetalle | null>(null);
  protected readonly nombres = NOMBRE_CALCULO;
  protected readonly lados = [
    { clave: 'P' as const, titulo: 'Percepciones' },
    { clave: 'D' as const, titulo: 'Deducciones' },
  ];

  protected readonly porNaturaleza = computed(() => {
    const conceptos = this.recibo()?.conceptos ?? [];
    return { P: conceptos.filter((c) => c.naturaleza === 'P'), D: conceptos.filter((c) => c.naturaleza === 'D') };
  });

  constructor() {
    effect(() => {
      const id = this.reciboId();
      this.recibo.set(null);
      this.api.recibo(id).subscribe((r) => this.recibo.set(r));
    });
  }

  protected pdf(id: number): void {
    this.api.archivo(`recibos/${id}/pdf`).subscribe((blob) => abrirArchivo(blob));
  }
}
