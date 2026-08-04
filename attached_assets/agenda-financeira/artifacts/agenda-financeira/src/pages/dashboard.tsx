import { useAppData } from '@/hooks/use-app-data';
import { formatCurrency } from '@/lib/format';
import { ArrowDownRight, ArrowUpRight, Calendar as CalendarIcon, CheckCircle2, ChevronLeft, ChevronRight, Minus, Pencil, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { differenceInDays, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, getDay, format, addMonths, subMonths, isSameDay, isToday, formatISO, addDays, startOfDay } from 'date-fns';
import { ContaReceber, ContaPagar } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { useState } from 'react';
import { ptBR } from 'date-fns/locale';

type ModalType = 'entrada' | 'saida' | 'receber' | 'pagar' | 'lembrete' | null;

export default function Dashboard() {
  const { contasReceber, contasPagar, perfil, allData: { setTransacoes, setContasReceber, setContasPagar, setLembretes } } = useAppData();
  const [modal, setModal] = useState<ModalType>(null);

  // Form states
  const [fValor, setFValor] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fCat, setFCat] = useState('');
  const [fData, setFData] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [fCliente, setFCliente] = useState('');
  const [fFornecedor, setFFornecedor] = useState('');
  const [fPagamento, setFPagamento] = useState('PIX');
  // Lembrete-specific states
  const [fLemTipo, setFLemTipo] = useState<'saida' | 'entrada'>('saida');
  const [fLemLancamento, setFLemLancamento] = useState<'unico' | 'mensal' | 'parcelado'>('unico');
  const [fLemParcelas, setFLemParcelas] = useState('2');

  const fechar = () => {
    setModal(null);
    setFValor(''); setFDesc(''); setFCat(''); setFData(format(new Date(), 'yyyy-MM-dd'));
    setFCliente(''); setFFornecedor(''); setFPagamento('PIX');
    setFLemTipo('saida'); setFLemLancamento('unico'); setFLemParcelas('2');
  };

  const salvar = () => {
    const id = Date.now().toString();
    const valor = parseFloat(fValor.replace(',', '.')) || 0;
    if (modal === 'entrada' || modal === 'saida') {
      setTransacoes(prev => [...prev, { id, perfil, tipo: modal, valor, data: formatISO(new Date(fData + 'T12:00:00')), categoria: fCat || 'Outros', descricao: fDesc || (modal === 'entrada' ? 'Nova entrada' : 'Nova saída'), pago: false }]);
    } else if (modal === 'receber') {
      setContasReceber(prev => [...prev, { id, perfil, cliente: fCliente || 'Cliente', valor, dataVencimento: formatISO(new Date(fData + 'T12:00:00')), status: 'pendente', formaPagamento: fPagamento as any, observacoes: '' }]);
    } else if (modal === 'pagar') {
      setContasPagar(prev => [...prev, { id, perfil, fornecedor: fFornecedor || 'Fornecedor', valor, dataVencimento: formatISO(new Date(fData + 'T12:00:00')), status: 'pendente', formaPagamento: fPagamento, categoria: fCat || 'Outros', observacoes: '' }]);
    } else if (modal === 'lembrete') {
      const baseDate = new Date(fData + 'T12:00:00');
      const desc = fDesc || 'Conta a pagar';
      const ehEntrada = fLemTipo === 'entrada';

      const makeReceber = (i: number, d: Date, v: number, label: string): ContaReceber => ({
        id: `${id}-${i}`, perfil, cliente: label, valor: v,
        dataVencimento: formatISO(d), status: 'pendente', formaPagamento: fPagamento as any, observacoes: '',
      });
      const makePagar = (i: number, d: Date, v: number, label: string): ContaPagar => ({
        id: `${id}-${i}`, perfil, fornecedor: label, valor: v,
        dataVencimento: formatISO(d), status: 'pendente', formaPagamento: fPagamento, categoria: fCat || 'Despesas Fixas', observacoes: '',
      });

      if (fLemLancamento === 'unico') {
        if (ehEntrada) setContasReceber(prev => [...prev, makeReceber(0, baseDate, valor, desc)]);
        else setContasPagar(prev => [...prev, makePagar(0, baseDate, valor, desc)]);
      } else if (fLemLancamento === 'mensal') {
        const datas = Array.from({ length: 12 }, (_, i) => { const d = new Date(baseDate); d.setMonth(d.getMonth() + i); return d; });
        if (ehEntrada) setContasReceber(prev => [...prev, ...datas.map((d, i) => makeReceber(i, d, valor, `${desc} (${i + 1}/12)`))]);
        else setContasPagar(prev => [...prev, ...datas.map((d, i) => makePagar(i, d, valor, `${desc} (${i + 1}/12)`))]);
      } else if (fLemLancamento === 'parcelado') {
        const n = Math.max(2, parseInt(fLemParcelas) || 2);
        const vParcela = valor / n;
        const datas = Array.from({ length: n }, (_, i) => { const d = new Date(baseDate); d.setMonth(d.getMonth() + i); return d; });
        if (ehEntrada) setContasReceber(prev => [...prev, ...datas.map((d, i) => makeReceber(i, d, vParcela, `${desc} (${i + 1}/${n})`))]);
        else setContasPagar(prev => [...prev, ...datas.map((d, i) => makePagar(i, d, vParcela, `${desc} (${i + 1}/${n})`))]);
      }
    }
    fechar();
  };

  const inicioMesAtual = startOfMonth(new Date());
  const fimMesAtual = endOfMonth(new Date());
  const totalReceber = contasReceber
    .filter(c => { const d = parseISO(c.dataVencimento); return d >= inicioMesAtual && d <= fimMesAtual; })
    .reduce((acc, curr) => acc + curr.valor, 0);
  const totalPagar = contasPagar
    .filter(c => { const d = parseISO(c.dataVencimento); return d >= inicioMesAtual && d <= fimMesAtual; })
    .reduce((acc, curr) => acc + curr.valor, 0);
  const saldoPrevisto = totalReceber - totalPagar;

  // Itens da semana (próximos 7 dias)
  const hoje = startOfDay(new Date());
  const fimSemana = addDays(hoje, 6);

  function parseParcelaSemana(nome: string): { base: string; atual: number; total: number } | null {
    const match = nome.match(/^(.+) \((\d+)\/(\d+)\)$/);
    if (match) return { base: match[1], atual: parseInt(match[2]), total: parseInt(match[3]) };
    return null;
  }

  const itensSemanaBrutos = [
    ...contasReceber.filter(c => c.status !== 'recebido').map(c => ({
      id: c.id, nome: c.cliente, valor: c.valor, data: c.dataVencimento, tipo: 'receber' as const, status: c.status,
    })),
    ...contasPagar.filter(c => c.status !== 'pago').map(c => ({
      id: c.id, nome: c.fornecedor, valor: c.valor, data: c.dataVencimento, tipo: 'pagar' as const, status: c.status,
    })),
  ].filter(item => {
    const d = startOfDay(parseISO(item.data));
    return d >= hoje && d <= fimSemana;
  }).sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());

  // Agrupa parcelas do mesmo lançamento
  type ItemSemana = typeof itensSemanaBrutos[0];
  type ItemSemanaGrupo = ItemSemana & { isGrupo?: boolean; grupoBase?: string; grupoTotal?: number; grupoItens?: ItemSemana[] };
  const semanaGrupoMap = new Map<string, ItemSemanaGrupo>();
  const itensSemana: ItemSemanaGrupo[] = [];
  for (const item of itensSemanaBrutos) {
    const p = parseParcelaSemana(item.nome);
    const chave = p ? `${item.tipo}-${p.base}` : null;
    if (p && chave) {
      if (!semanaGrupoMap.has(chave)) {
        const grupoItem: ItemSemanaGrupo = { ...item, nome: p.base, isGrupo: true, grupoBase: p.base, grupoTotal: p.total, grupoItens: [] };
        semanaGrupoMap.set(chave, grupoItem);
        itensSemana.push(grupoItem);
      }
      semanaGrupoMap.get(chave)!.grupoItens!.push(item);
      semanaGrupoMap.get(chave)!.valor = semanaGrupoMap.get(chave)!.grupoItens!.reduce((a, c) => a + c.valor, 0);
    } else {
      itensSemana.push(item);
    }
  }

  const marcarPago = (id: string, tipo: 'receber' | 'pagar') => {
    if (tipo === 'receber') {
      setContasReceber((prev: ContaReceber[]) => prev.map(c => c.id === id ? { ...c, status: 'recebido' } : c));
    } else {
      setContasPagar((prev: ContaPagar[]) => prev.map(c => c.id === id ? { ...c, status: 'pago' } : c));
    }
  };

  return (
    <div className="p-4 space-y-6">
      {/* Resumo do mês */}
      <div>
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Resumo do mês</h3>
        <div className="grid grid-cols-3 gap-2">
          <Card className="bg-white border-green-100 border">
            <CardContent className="p-3 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-1">A Receber</span>
              <span className="text-sm font-bold text-green-600">{formatCurrency(totalReceber)}</span>
              <span className="text-[10px] text-green-600/80 mt-1 flex items-center"><ArrowUpRight className="w-3 h-3 mr-0.5" /> 12%</span>
            </CardContent>
          </Card>
          <Card className="bg-white border-red-100 border">
            <CardContent className="p-3 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-1">A Pagar</span>
              <span className="text-sm font-bold text-red-600">{formatCurrency(totalPagar)}</span>
              <span className="text-[10px] text-red-600/80 mt-1 flex items-center"><ArrowDownRight className="w-3 h-3 mr-0.5" /> 5%</span>
            </CardContent>
          </Card>
          <Card className="bg-blue-50 border-blue-100 border">
            <CardContent className="p-3 flex flex-col items-center justify-center text-center">
              <span className="text-[9px] text-blue-600 font-medium uppercase tracking-wider mb-1 leading-tight">Saldo Previsto</span>
              <span className="text-sm font-bold text-blue-700">{formatCurrency(saldoPrevisto)}</span>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Resumo da semana */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900 text-sm">Resumo da semana</h3>
          <span className="text-xs text-gray-400">
            {format(hoje, 'dd/MM')} – {format(fimSemana, 'dd/MM')}
          </span>
        </div>
        {itensSemana.length === 0 ? (
          <div className="bg-white rounded-xl p-3 border border-gray-100 flex items-center gap-3">
            <div className="bg-blue-50 p-2 rounded-lg text-blue-600">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-gray-900">Nenhum vencimento esta semana</p>
            <CheckCircle2 className="w-5 h-5 text-green-500 ml-auto flex-shrink-0" />
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
            {itensSemana.map(item => {
              const dias = differenceInDays(parseISO(item.data), new Date());
              const atrasado = dias < 0 || item.status === 'atrasado';
              const dotColor = atrasado ? 'bg-red-500' : item.tipo === 'receber' ? 'bg-green-500' : 'bg-orange-400';
              const valorColor = atrasado ? 'text-red-600' : item.tipo === 'receber' ? 'text-green-600' : 'text-orange-500';
              const isPago = item.isGrupo
                ? item.grupoItens!.every(i => i.status === 'recebido' || i.status === 'pago')
                : item.status === 'recebido' || item.status === 'pago';
              const handleMarcar = () => {
                if (item.isGrupo) {
                  item.grupoItens!.forEach(i => marcarPago(i.id, i.tipo));
                } else {
                  marcarPago(item.id, item.tipo);
                }
              };
              return (
                <div key={`${item.tipo}-${item.id}`} className="flex items-center gap-3 px-4 py-3">
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${dotColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-gray-900 truncate">{item.nome}</p>
                      {item.isGrupo && (
                        <span className="flex-shrink-0 text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                          {item.grupoItens!.length}×
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400">
                      {parseISO(item.data).toLocaleDateString('pt-BR')} &bull; {atrasado ? 'Atrasado' : dias === 0 ? 'Vence hoje' : `Em ${dias} dias`}
                    </p>
                  </div>
                  <span className={`text-sm font-bold flex-shrink-0 ${valorColor}`}>{formatCurrency(item.valor)}</span>
                  <button
                    onClick={handleMarcar}
                    className={`flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isPago
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-gray-300 text-transparent hover:border-green-400'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ações rápidas */}
      <div>
        <h3 className="font-semibold text-gray-900 text-sm mb-3">Ações rápidas</h3>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { label: 'Nova entrada', sub: 'Receber', icon: <Plus className="w-4 h-4" />, bg: 'bg-green-500', action: 'entrada' as ModalType },
            { label: 'Nova saída', sub: 'Pagar', icon: <Minus className="w-4 h-4" />, bg: 'bg-red-500', action: 'saida' as ModalType },
            { label: 'Conta receber', sub: 'Adicionar', icon: <UserPlus className="w-4 h-4" />, bg: 'bg-blue-500', action: 'receber' as ModalType },
            { label: 'Contas a Pagar', sub: 'Criar', icon: <BellIcon className="w-4 h-4" />, bg: 'bg-purple-600', action: 'lembrete' as ModalType },
          ].map((action) => (
            <button
              key={action.label}
              onClick={() => setModal(action.action)}
              className="flex flex-col items-center gap-1.5 bg-white rounded-xl border border-gray-100 shadow-sm py-3 px-1 active:scale-95 transition-transform"
            >
              <div className={`w-10 h-10 rounded-full ${action.bg} text-white flex items-center justify-center shadow-sm`}>
                {action.icon}
              </div>
              <span className="text-[9px] font-semibold text-gray-800 text-center leading-tight">{action.label}</span>
              <span className="text-[9px] text-blue-600 font-medium">{action.sub}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Calendário */}
      <AgendaCalendar
        contasReceber={contasReceber}
        contasPagar={contasPagar}
        totalReceber={totalReceber}
        totalPagar={totalPagar}
        setContasReceber={setContasReceber}
        setContasPagar={setContasPagar}
      />
      

      {/* Modal de Ação Rápida */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={fechar}>
          <div className="w-full max-w-[430px] bg-white rounded-t-3xl p-6 pb-10 space-y-4" onClick={e => e.stopPropagation()}>
            {/* Cabeçalho */}
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-gray-900 text-base">
                {modal === 'entrada' && 'Nova Entrada'}
                {modal === 'saida' && 'Nova Saída'}
                {modal === 'receber' && 'Conta a Receber'}
                {modal === 'pagar' && 'Conta a Pagar'}
                {modal === 'lembrete' && 'Contas a Pagar'}
              </h2>
              <button onClick={fechar} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Campos comuns: entrada/saída */}
            {(modal === 'entrada' || modal === 'saida') && (
              <>
                <Field label="Descrição">
                  <input className={inputCls} placeholder="Ex: Consultoria, DAS..." value={fDesc} onChange={e => setFDesc(e.target.value)} />
                </Field>
                <Field label="Valor (R$)">
                  <input className={inputCls} type="number" placeholder="0,00" value={fValor} onChange={e => setFValor(e.target.value)} />
                </Field>
                <Field label="Categoria">
                  <input className={inputCls} placeholder="Ex: Serviços, Impostos..." value={fCat} onChange={e => setFCat(e.target.value)} />
                </Field>
                <Field label="Data">
                  <input className={inputCls} type="date" value={fData} onChange={e => setFData(e.target.value)} />
                </Field>
              </>
            )}

            {/* Campos: conta a receber */}
            {modal === 'receber' && (
              <>
                <Field label="Cliente">
                  <input className={inputCls} placeholder="Nome do cliente" value={fCliente} onChange={e => setFCliente(e.target.value)} />
                </Field>
                <Field label="Valor (R$)">
                  <input className={inputCls} type="number" placeholder="0,00" value={fValor} onChange={e => setFValor(e.target.value)} />
                </Field>
                <Field label="Vencimento">
                  <input className={inputCls} type="date" value={fData} onChange={e => setFData(e.target.value)} />
                </Field>
                <Field label="Forma de pagamento">
                  <select className={inputCls} value={fPagamento} onChange={e => setFPagamento(e.target.value)}>
                    {['PIX', 'Boleto', 'Cartão', 'Dinheiro', 'Transferência'].map(f => <option key={f}>{f}</option>)}
                  </select>
                </Field>
              </>
            )}

            {/* Campos: conta a pagar */}
            {modal === 'pagar' && (
              <>
                <Field label="Fornecedor">
                  <input className={inputCls} placeholder="Nome do fornecedor" value={fFornecedor} onChange={e => setFFornecedor(e.target.value)} />
                </Field>
                <Field label="Valor (R$)">
                  <input className={inputCls} type="number" placeholder="0,00" value={fValor} onChange={e => setFValor(e.target.value)} />
                </Field>
                <Field label="Vencimento">
                  <input className={inputCls} type="date" value={fData} onChange={e => setFData(e.target.value)} />
                </Field>
                <Field label="Categoria">
                  <input className={inputCls} placeholder="Ex: Aluguel, Internet..." value={fCat} onChange={e => setFCat(e.target.value)} />
                </Field>
              </>
            )}

            {/* Campos: lembrete de pagamento */}
            {modal === 'lembrete' && (
              <>
                <Field label="Descrição">
                  <input className={inputCls} placeholder="Ex: Aluguel, Salário, TV Samsung..." value={fDesc} onChange={e => setFDesc(e.target.value)} />
                </Field>

                <Field label="Tipo">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFLemTipo('saida')}
                      className={`py-2.5 rounded-xl font-semibold text-sm transition-colors ${fLemTipo === 'saida' ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                    >Saída</button>
                    <button
                      type="button"
                      onClick={() => setFLemTipo('entrada')}
                      className={`py-2.5 rounded-xl font-semibold text-sm transition-colors ${fLemTipo === 'entrada' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'}`}
                    >Entrada</button>
                  </div>
                </Field>

                <Field label="Valor (R$)">
                  <input className={inputCls} type="number" placeholder="0,00" value={fValor} onChange={e => setFValor(e.target.value)} />
                </Field>

                <Field label={fLemLancamento === 'unico' ? 'Data' : fLemLancamento === 'mensal' ? 'Data de início' : 'Data da 1ª parcela'}>
                  <input className={inputCls} type="date" value={fData} onChange={e => setFData(e.target.value)} />
                </Field>

                <Field label="Tipo de lançamento">
                  <div className="space-y-2">
                    {[
                      { value: 'unico', icon: '🔵', title: 'Lançamento único', desc: 'Aparece só uma vez na agenda' },
                      { value: 'mensal', icon: '🔄', title: 'Despesa fixa mensal', desc: 'Repete todo mês por 12 meses (ex: aluguel, plano de saúde)' },
                      { value: 'parcelado', icon: '💳', title: 'Parcelado', desc: 'Cartão de crédito ou financiamento' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFLemLancamento(opt.value as any)}
                        className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-colors ${fLemLancamento === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-100 bg-white'}`}
                      >
                        <span className="text-base mt-0.5">{opt.icon}</span>
                        <div>
                          <p className={`text-sm font-semibold ${fLemLancamento === opt.value ? 'text-blue-700' : 'text-gray-800'}`}>{opt.title}</p>
                          <p className="text-xs text-gray-500 mt-0.5 leading-snug">{opt.desc}</p>
                        </div>
                        <div className={`ml-auto w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${fLemLancamento === opt.value ? 'border-blue-500' : 'border-gray-300'}`}>
                          {fLemLancamento === opt.value && <div className="w-2 h-2 rounded-full bg-blue-500" />}
                        </div>
                      </button>
                    ))}
                  </div>
                </Field>

                {fLemLancamento === 'parcelado' && (
                  <Field label="Número de parcelas">
                    <div className="flex items-center gap-2">
                      <input
                        className={`${inputCls} w-20 flex-shrink-0`}
                        type="number" min="2" placeholder="2"
                        value={fLemParcelas}
                        onChange={e => setFLemParcelas(e.target.value)}
                      />
                      <span className="text-sm text-gray-500 whitespace-nowrap">
                        × {formatCurrency(parseFloat(fValor.replace(',', '.')) / Math.max(2, parseInt(fLemParcelas) || 2) || 0)} = {formatCurrency(parseFloat(fValor.replace(',', '.')) || 0)}
                      </span>
                    </div>
                  </Field>
                )}
              </>
            )}

            <button
              onClick={salvar}
              className={`w-full py-3 rounded-xl font-semibold text-white text-sm mt-2 ${
                modal === 'entrada' ? 'bg-green-500' :
                modal === 'saida' ? 'bg-red-500' :
                modal === 'receber' ? 'bg-blue-500' :
                modal === 'pagar' ? 'bg-orange-500' :
                'bg-blue-400'
              }`}
            >
              {modal === 'lembrete'
                ? fLemLancamento === 'mensal'
                  ? 'Criar 12 lembretes mensais'
                  : fLemLancamento === 'parcelado'
                  ? `Criar ${Math.max(2, parseInt(fLemParcelas) || 2)} parcelas`
                  : 'Salvar'
                : 'Salvar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

type AgendaCalendarProps = {
  contasReceber: ContaReceber[];
  contasPagar: ContaPagar[];
  totalReceber: number;
  totalPagar: number;
  setContasReceber: (fn: (prev: ContaReceber[]) => ContaReceber[]) => void;
  setContasPagar: (fn: (prev: ContaPagar[]) => ContaPagar[]) => void;
};

function AgendaCalendar({ contasReceber, contasPagar, totalReceber, totalPagar, setContasReceber, setContasPagar }: AgendaCalendarProps) {
  const [viewMonth, setViewMonth] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValor, setEditValor] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const monthStart = startOfMonth(viewMonth);
  const monthEnd = endOfMonth(viewMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const leadingBlanks = getDay(monthStart); // 0=Sun

  const today = new Date();

  function getDotType(day: Date): 'receber' | 'pagar' | 'hoje' | 'atrasado' | 'concluido' | null {
    const receberNoDia = contasReceber.filter(c => isSameDay(parseISO(c.dataVencimento), day));
    const pagarNoDia = contasPagar.filter(c => isSameDay(parseISO(c.dataVencimento), day));

    if (receberNoDia.length === 0 && pagarNoDia.length === 0) return null;

    const hasReceber = receberNoDia.some(c => c.status !== 'recebido');
    const hasPagar = pagarNoDia.some(c => c.status !== 'pago');

    // Todos concluídos → ✅
    if (!hasReceber && !hasPagar) return 'concluido';

    const isAtrasado =
      (hasReceber && receberNoDia.some(c => c.status === 'atrasado')) ||
      (hasPagar && pagarNoDia.some(c => c.status === 'atrasado'));

    if (isAtrasado) return 'atrasado';
    if (isToday(day)) return 'hoje';
    if (hasPagar) return 'pagar';
    return 'receber';
  }

  const dotColors: Record<string, string> = {
    receber: 'bg-green-500',
    pagar: 'bg-red-500',
    hoje: 'bg-orange-400',
    atrasado: 'bg-red-700',
  };

  const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const itensNoDia = selectedDay ? [
    ...contasReceber.filter(c => isSameDay(parseISO(c.dataVencimento), selectedDay)).map(c => ({
      id: c.id, tipo: 'receber' as const, nome: c.cliente, valor: c.valor, status: c.status, extra: c.formaPagamento,
    })),
    ...contasPagar.filter(c => isSameDay(parseISO(c.dataVencimento), selectedDay)).map(c => ({
      id: c.id, tipo: 'pagar' as const, nome: c.fornecedor, valor: c.valor, status: c.status, extra: c.categoria,
    })),
  ] : [];

  const salvarEdicao = (id: string, tipo: 'receber' | 'pagar') => {
    const novoValor = parseFloat(editValor.replace(',', '.'));
    if (tipo === 'receber') {
      setContasReceber(prev => prev.map(c => c.id === id ? { ...c, valor: isNaN(novoValor) ? c.valor : novoValor, cliente: editDesc || c.cliente } : c));
    } else {
      setContasPagar(prev => prev.map(c => c.id === id ? { ...c, valor: isNaN(novoValor) ? c.valor : novoValor, fornecedor: editDesc || c.fornecedor } : c));
    }
    setEditingId(null);
  };

  const excluirItem = (id: string, tipo: 'receber' | 'pagar') => {
    if (tipo === 'receber') setContasReceber(prev => prev.filter(c => c.id !== id));
    else setContasPagar(prev => prev.filter(c => c.id !== id));
    if (itensNoDia.length <= 1) setSelectedDay(null);
  };

  const marcarDia = (id: string, tipo: 'receber' | 'pagar') => {
    if (tipo === 'receber') setContasReceber(prev => prev.map(c => c.id === id ? { ...c, status: 'recebido' } : c));
    else setContasPagar(prev => prev.map(c => c.id === id ? { ...c, status: 'pago' } : c));
  };

  const totalReceberMes = contasReceber
    .filter(c => { const d = parseISO(c.dataVencimento); return d >= monthStart && d <= monthEnd; })
    .reduce((acc, c) => acc + c.valor, 0);

  const totalPagarMes = contasPagar
    .filter(c => { const d = parseISO(c.dataVencimento); return d >= monthStart && d <= monthEnd; })
    .reduce((acc, c) => acc + c.valor, 0);

  return (
    <>
    <Card className="border-gray-100 shadow-sm">
      <CardContent className="p-4">
        {/* Totais */}
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-semibold text-gray-900 text-sm">Agenda Financeira</h3>
          <div className="flex gap-3 text-[11px] font-semibold">
            <span className="text-green-600 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              Receber: {formatCurrency(totalReceberMes)}
            </span>
            <span className="text-red-600 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
              Pagar: {formatCurrency(totalPagarMes)}
            </span>
          </div>
        </div>

        {/* Navegação do mês */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setViewMonth(m => subMonths(m, 1))}
            className="p-1 rounded-full hover:bg-gray-100 text-gray-500"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-semibold text-gray-800 text-base capitalize">
            {format(viewMonth, 'MMMM yyyy', { locale: ptBR })}
          </span>
          <button
            onClick={() => setViewMonth(m => addMonths(m, 1))}
            className="p-1 rounded-full hover:bg-gray-100 text-gray-500"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>

        {/* Cabeçalho dos dias */}
        <div className="grid grid-cols-7 mb-1">
          {DIAS.map(d => (
            <div key={d} className="text-center text-[11px] font-semibold text-blue-600 py-1">{d}</div>
          ))}
        </div>

        {/* Células */}
        <div className="grid grid-cols-7 gap-y-1">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {days.map(day => {
            const dot = getDotType(day);
            const todayDay = isToday(day);
            const hasEvent = dot !== null;
            const concluido = dot === 'concluido';

            return (
              <button
                key={day.toISOString()}
                onClick={() => hasEvent && setSelectedDay(day)}
                className={`flex flex-col items-center justify-center py-1.5 rounded-lg mx-0.5 transition-colors ${
                  concluido ? 'bg-green-50 active:bg-green-100 cursor-pointer' :
                  hasEvent ? 'bg-red-50 active:bg-red-100 cursor-pointer' : 'cursor-default'
                } ${todayDay ? 'ring-2 ring-green-500' : ''}`}
              >
                <span className={`text-sm font-medium leading-none ${
                  concluido ? 'text-green-600' :
                  hasEvent ? 'text-red-600' :
                  todayDay ? 'text-green-700' : 'text-gray-700'
                }`}>
                  {format(day, 'd')}
                </span>
                {concluido ? (
                  <span className="text-[10px] leading-none mt-0.5">✅</span>
                ) : dot ? (
                  <span className={`w-1.5 h-1.5 rounded-full mt-1 ${dotColors[dot]}`} />
                ) : (
                  <span className="w-1.5 h-1.5 mt-1" />
                )}
              </button>
            );
          })}
        </div>

        {/* Legenda */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 justify-center">
          {[
            { label: 'Receber', color: 'bg-green-500', text: 'text-green-700' },
            { label: 'Pagar', color: 'bg-red-500', text: 'text-red-700' },
            { label: 'Vencendo hoje', color: 'bg-orange-400', text: 'text-orange-600' },
            { label: 'Atrasado', color: 'bg-red-700', text: 'text-red-900' },
          ].map(({ label, color, text }) => (
            <span key={label} className={`flex items-center gap-1 text-[11px] font-medium ${text}`}>
              <span className={`w-2 h-2 rounded-full ${color}`} /> {label}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>

    {/* Painel de detalhes do dia selecionado */}
    {selectedDay && (
      <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/40" onClick={() => { setSelectedDay(null); setEditingId(null); }}>
        <div className="w-full max-w-[430px] bg-white rounded-t-3xl p-5 pb-10" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-900">
              {format(selectedDay, "dd 'de' MMMM", { locale: ptBR })}
            </h3>
            <button onClick={() => { setSelectedDay(null); setEditingId(null); }} className="text-gray-400">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3">
            {itensNoDia.map(item => {
              const pago = item.status === 'recebido' || item.status === 'pago';
              const cor = item.tipo === 'receber' ? 'text-green-600' : 'text-red-600';
              const isEditing = editingId === item.id;
              return (
                <div key={item.id} className={`rounded-xl border p-3 space-y-2 ${pago ? 'border-green-100 bg-green-50' : 'border-gray-100 bg-white'}`}>
                  {isEditing ? (
                    <>
                      <input className={inputCls} value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Nome" />
                      <input className={inputCls} type="number" value={editValor} onChange={e => setEditValor(e.target.value)} placeholder="Valor" />
                      <div className="flex gap-2">
                        <button onClick={() => salvarEdicao(item.id, item.tipo)} className="flex-1 py-2 rounded-xl bg-green-500 text-white text-sm font-semibold">Salvar</button>
                        <button onClick={() => setEditingId(null)} className="flex-1 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-semibold">Cancelar</button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => marcarDia(item.id, item.tipo)}
                        className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${pago ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300'}`}
                      >
                        {pago && <CheckCircle2 className="w-4 h-4" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${pago ? 'line-through text-gray-400' : 'text-gray-900'}`}>{item.nome}</p>
                        <p className="text-xs text-gray-400">{item.extra}</p>
                      </div>
                      <span className={`text-sm font-bold flex-shrink-0 ${cor}`}>{formatCurrency(item.valor)}</span>
                      <button onClick={() => { setEditingId(item.id); setEditDesc(item.nome); setEditValor(String(item.valor)); }} className="text-gray-400 hover:text-blue-500">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => excluirItem(item.id, item.tipo)} className="text-gray-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function BellIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}