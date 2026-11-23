import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const CURP = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z\d]\d$/;
const RFC = /^[A-ZÑ&]{4}\d{6}[A-Z\d]{0,3}$/;

export class DatosPersonalesDto {
  @IsOptional() @IsIn(['H', 'M', '']) sexo?: string;
  @IsOptional() @IsString() @MaxLength(20) estadoCivil?: string;
  @IsOptional() @IsString() @MaxLength(120) correo?: string;
  @IsOptional() @IsString() @MaxLength(20) telefono?: string;
  @IsOptional() @IsString() @MaxLength(150) domicilio?: string;
  @IsOptional() @IsString() @MaxLength(80) colonia?: string;
  @IsOptional() @IsString() @MaxLength(5) codigoPostal?: string;
  @IsOptional() @IsString() @MaxLength(40) entidad?: string;
  @IsOptional() @IsString() @MaxLength(80) profesion?: string;
  @IsOptional() @IsString() observaciones?: string;
}

export class ActualizarEmpleadoDto {
  @IsOptional() @Matches(RFC, { message: 'El RFC no tiene el formato correcto' }) rfc?: string;
  @IsOptional() @IsString() @MaxLength(50) apellidoPaterno?: string;
  @IsOptional() @IsString() @MaxLength(50) apellidoMaterno?: string;
  @IsOptional() @IsString() @MaxLength(60) nombres?: string;
  @IsOptional() @IsInt() adscripcionId?: number;
  @IsOptional() @IsString() @MaxLength(12) puestoClave?: string;
  @IsOptional() @IsInt() @Min(1) nivel?: number;
  @IsOptional() @IsInt() @Min(1) rango?: number;
  @IsOptional() @IsInt() numeroIssemym?: number | null;
  @IsOptional() @IsBoolean() sindicalizado?: boolean;
  @IsOptional() @IsBoolean() sci?: boolean;
  @IsOptional() @IsDateString() fechaIngresoGobierno?: string | null;
  @IsOptional() @IsDateString() fechaNacimiento?: string | null;
  @IsOptional() @Matches(/^\d{5}$/, { message: 'El código postal fiscal son 5 dígitos' }) codigoPostalFiscal?: string | null;
  @IsOptional() @IsString() @MaxLength(20) banco?: string | null;
  @IsOptional() @Matches(/^(\d{10}|\d{11}|\d{16}|\d{18})$/, { message: 'La cuenta debe ser de 10, 11, 16 o 18 dígitos' }) cuentaBancaria?: string | null;
  @IsOptional() @IsBoolean() pagoCheque?: boolean;
  @IsOptional() @ValidateNested() @Type(() => DatosPersonalesDto) datosPersonales?: DatosPersonalesDto;
}

export class CrearEmpleadoDto extends ActualizarEmpleadoDto {
  @Matches(CURP, { message: 'La CURP no tiene el formato correcto' }) declare curp: string;
  @Matches(RFC, { message: 'El RFC no tiene el formato correcto' }) declare rfc: string;
  @IsString() @MaxLength(50) declare apellidoPaterno: string;
  @IsString() @MaxLength(60) declare nombres: string;
  @IsString() @MaxLength(1) declare tipoNomina: string;
  @IsInt() declare adscripcionId: number;
  @IsString() declare puestoClave: string;
  @IsInt() @Min(1) declare nivel: number;
  @IsInt() @Min(1) declare rango: number;
  @IsDateString() declare fechaAlta: string;
}

export class ImporteDto {
  @IsNumber({ maxDecimalPlaces: 2 }) importe: number;
  /** Solo para esta persona; null = como la quincena o el catálogo. */
  @IsOptional() @IsBoolean() gravaIsr?: boolean | null;
  @IsOptional() @IsBoolean() timbra?: boolean | null;
}

export class DescuentoPlazoDto {
  @IsInt() conceptoId: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) importeQuincenal: number;
  @IsOptional() @IsNumber() @Min(0) porcentaje?: number | null;
  @IsOptional() @IsInt() @Min(0) quincenasPendientes?: number | null;
  @IsOptional() @IsString() @MaxLength(120) beneficiario?: string | null;
  @IsOptional() @IsBoolean() activo?: boolean;
}

export class CuentaContableDto {
  @IsInt() conceptoId: number;
  @IsString() @Matches(/^\d{1,16}$/, { message: 'La partida son hasta 16 dígitos' }) partida: string;
}

export class SucursalDto {
  @IsInt() @Min(0) sucursal: number;
  @IsIn(['E', 'D']) tipo: string;
}

export class BajaDto {
  @IsDateString() fecha: string;
  @IsString() motivoClave: string;
  @IsOptional() @IsString() observaciones?: string;
}

export class PermisoDto {
  @IsDateString() inicio: string;
  @IsOptional() @IsDateString() fin?: string | null;
  @IsString() motivoClave: string;
  @IsOptional() @IsString() observaciones?: string;
}

export class ReingresoDto {
  @IsDateString() fecha: string;
  @IsOptional() @IsString() observaciones?: string;
}

export class FiltroEmpleadosDto {
  @IsOptional() @IsString() tipoNomina?: string;
  @IsOptional() @IsIn(['activo', 'permiso', 'baja', 'todos']) estado?: string;
  @IsOptional() @Type(() => Number) @IsInt() adscripcionId?: number;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) limite?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) desde?: number;
}
