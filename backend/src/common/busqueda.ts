import { Op, Sequelize } from 'sequelize';

/** Patrón LIKE sin acentos ni mayúsculas, sin los comodines que haya escrito la persona. */
export const patron = (texto: string) =>
  `%${texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[%_\\]/g, '')}%`;

/** `columna` (o expresión) contiene `texto`, ignorando acentos y mayúsculas. */
export const contiene = (expresion: ReturnType<typeof Sequelize.col> | ReturnType<typeof Sequelize.fn>, texto: string) =>
  Sequelize.where(Sequelize.fn('sin_acentos', expresion), { [Op.like]: patron(texto) });
