import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface Capacidades {
  capturar: boolean;
  calcular: boolean;
  catalogos: boolean;
  cerrar: boolean;
  administrar: boolean;
}

export interface AuthUser {
  id: number;
  usuario: string;
  nombre: string;
  rol: string;
  capacidades: Capacidades;
}

interface LoginResponse {
  access_token: string;
  user: AuthUser;
}

const TOKEN_KEY = 'sigenom_token';
const USER_KEY = 'sigenom_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  readonly currentUser = signal<AuthUser | null>(this.leerUsuario());

  login(usuario: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${environment.apiUrl}/auth/login`, { usuario, password }).pipe(
      tap(({ access_token, user }) => {
        localStorage.setItem(TOKEN_KEY, access_token);
        this.guardarUsuario(user);
      }),
    );
  }

  /** Vuelve a pedir el usuario: su rol pudo cambiar desde Administración. */
  refrescar(): void {
    this.http.get<AuthUser>(`${environment.apiUrl}/auth/me`).subscribe((user) => this.guardarUsuario(user));
  }

  cambiarContrasena(actual: string, nueva: string): Observable<void> {
    return this.http.put<void>(`${environment.apiUrl}/auth/contrasena`, { actual, nueva });
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.currentUser.set(null);
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  get isAuthenticated(): boolean {
    return !!this.token;
  }

  private guardarUsuario(user: AuthUser): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.currentUser.set(user);
  }

  private leerUsuario(): AuthUser | null {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? (JSON.parse(raw) as AuthUser) : null;
    } catch {
      return null;
    }
  }
}
