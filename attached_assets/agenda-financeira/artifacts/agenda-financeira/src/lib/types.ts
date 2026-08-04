export type Perfil = 'PF' | 'PJ';

export type Transacao = {
  id: string;
  perfil: Perfil;
  tipo: 'entrada' | 'saida';
  valor: number;
  data: string; // ISO
  categoria: string;
  descricao: string;
  pago: boolean;
};

export type ContaReceber = {
  id: string;
  perfil: Perfil;
  cliente: string;
  valor: number;
  dataVencimento: string; // ISO
  status: 'pendente' | 'parcial' | 'recebido' | 'atrasado';
  formaPagamento: 'PIX' | 'Boleto' | 'Cartão' | 'Dinheiro' | 'Transferência';
  observacoes: string;
};

export type ContaPagar = {
  id: string;
  perfil: Perfil;
  fornecedor: string;
  valor: number;
  dataVencimento: string; // ISO
  status: 'pendente' | 'parcial' | 'pago' | 'atrasado';
  formaPagamento: string;
  categoria: string;
  observacoes: string;
};

export type Lembrete = {
  id: string;
  perfil: Perfil;
  titulo: string;
  data: string;
  tipo: string;
};
