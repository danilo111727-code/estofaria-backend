import { useLocalStorage } from './use-local-storage';
import { Perfil, Transacao, ContaReceber, ContaPagar, Lembrete } from '@/lib/types';
import { addDays, subDays, formatISO } from 'date-fns';

const today = new Date();

const seedTransacoes: Transacao[] = [
  { id: '1', perfil: 'PJ', tipo: 'entrada', valor: 5000, data: formatISO(subDays(today, 2)), categoria: 'Serviços', descricao: 'Consultoria Cliente A', pago: true },
  { id: '2', perfil: 'PJ', tipo: 'saida', valor: 1200, data: formatISO(subDays(today, 1)), categoria: 'Impostos', descricao: 'DAS', pago: true },
  { id: '3', perfil: 'PF', tipo: 'entrada', valor: 3000, data: formatISO(subDays(today, 5)), categoria: 'Salário', descricao: 'Salário', pago: true },
];

const seedContasReceber: ContaReceber[] = [
  { id: '1', perfil: 'PJ', cliente: 'Empresa XYZ', valor: 2500, dataVencimento: formatISO(addDays(today, 3)), status: 'pendente', formaPagamento: 'PIX', observacoes: '' },
  { id: '2', perfil: 'PJ', cliente: 'Cliente B', valor: 800, dataVencimento: formatISO(subDays(today, 1)), status: 'atrasado', formaPagamento: 'Boleto', observacoes: '' },
];

const seedContasPagar: ContaPagar[] = [
  { id: '1', perfil: 'PJ', fornecedor: 'Internet', valor: 150, dataVencimento: formatISO(addDays(today, 5)), status: 'pendente', formaPagamento: 'Boleto', categoria: 'Despesas Fixas', observacoes: '' },
];

const seedLembretes: Lembrete[] = [
  { id: '1', perfil: 'PJ', titulo: 'Cobrar Cliente B', data: formatISO(today), tipo: 'cobrança' }
];


export function useAppData() {
  const [perfil, setPerfil] = useLocalStorage<Perfil>('agenda-fin-perfil', 'PJ');
  const [transacoes, setTransacoes] = useLocalStorage<Transacao[]>('agenda-fin-transacoes', seedTransacoes);
  const [contasReceber, setContasReceber] = useLocalStorage<ContaReceber[]>('agenda-fin-receber', seedContasReceber);
  const [contasPagar, setContasPagar] = useLocalStorage<ContaPagar[]>('agenda-fin-pagar', seedContasPagar);
  const [lembretes, setLembretes] = useLocalStorage<Lembrete[]>('agenda-fin-lembretes', seedLembretes);

  const togglePerfil = () => setPerfil(p => p === 'PJ' ? 'PF' : 'PJ');

  const filterByPerfil = <T extends { perfil: Perfil }>(items: T[]) => items.filter(item => item.perfil === perfil);

  return {
    perfil,
    setPerfil,
    togglePerfil,
    transacoes: filterByPerfil(transacoes),
    contasReceber: filterByPerfil(contasReceber),
    contasPagar: filterByPerfil(contasPagar),
    lembretes: filterByPerfil(lembretes),
    allData: {
      transacoes, setTransacoes,
      contasReceber, setContasReceber,
      contasPagar, setContasPagar,
      lembretes, setLembretes
    },
    limparDados: () => {
      setTransacoes([]);
      setContasReceber([]);
      setContasPagar([]);
      setLembretes([]);
    }
  };
}
