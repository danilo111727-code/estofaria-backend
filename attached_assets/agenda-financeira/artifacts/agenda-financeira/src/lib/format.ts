import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatDate(dateString: string, formatStr: string = 'dd/MM/yyyy'): string {
  try {
    const date = parseISO(dateString);
    return format(date, formatStr, { locale: ptBR });
  } catch (e) {
    return dateString;
  }
}
