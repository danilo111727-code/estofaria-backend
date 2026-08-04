import { useState } from 'react';
import { useAppData } from '@/hooks/use-app-data';
import { formatCurrency, formatDate } from '@/lib/format';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Transacao } from '@/lib/types';

function parseParcela(texto: string): { base: string; atual: number; total: number } | null {
  const match = texto.match(/^(.+) \((\d+)\/(\d+)\)$/);
  if (match) return { base: match[1], atual: parseInt(match[2]), total: parseInt(match[3]) };
  return null;
}

type Grupo = {
  key: string;
  base: string;
  tipo: 'entrada' | 'saida';
  categoria: string;
  valorTotal: number;
  itens: Transacao[];
};

type ItemLista = { kind: 'avulso'; transacao: Transacao } | { kind: 'grupo'; grupo: Grupo };

function agruparTransacoes(transacoes: Transacao[]): ItemLista[] {
  const grupos = new Map<string, Grupo>();
  const lista: ItemLista[] = [];

  for (const t of transacoes) {
    const p = parseParcela(t.descricao);
    if (p) {
      const key = `${t.tipo}-${p.base}`;
      if (!grupos.has(key)) {
        const g: Grupo = { key, base: p.base, tipo: t.tipo, categoria: t.categoria, valorTotal: 0, itens: [] };
        grupos.set(key, g);
        lista.push({ kind: 'grupo', grupo: g });
      }
      const g = grupos.get(key)!;
      g.itens.push(t);
      g.valorTotal += t.valor;
    } else {
      lista.push({ kind: 'avulso', transacao: t });
    }
  }

  return lista;
}

export default function Caixa() {
  const { transacoes, allData: { setTransacoes } } = useAppData();
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const entradas = transacoes.filter(t => t.tipo === 'entrada').reduce((a, c) => a + c.valor, 0);
  const saidas = transacoes.filter(t => t.tipo === 'saida').reduce((a, c) => a + c.valor, 0);
  const saldo = entradas - saidas;

  const chartData = [
    { name: 'Jan', entradas: 4000, saidas: 2400 },
    { name: 'Fev', entradas: 3000, saidas: 1398 },
    { name: 'Mar', entradas: 2000, saidas: 9800 },
    { name: 'Abr', entradas: 2780, saidas: 3908 },
    { name: 'Mai', entradas: 1890, saidas: 4800 },
    { name: 'Jun', entradas: 2390, saidas: 3800 },
  ];

  const deletar = (id: string) => setTransacoes(prev => prev.filter(t => t.id !== id));
  const deletarGrupo = (ids: string[]) => setTransacoes(prev => prev.filter(t => !ids.includes(t.id)));

  const toggleExpandir = (key: string) => {
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const lista = agruparTransacoes([...transacoes].reverse());

  return (
    <div className="p-4 space-y-6">
      <div className="bg-blue-600 rounded-2xl p-5 text-white shadow-md">
        <p className="text-blue-100 text-sm font-medium mb-1">Saldo em Caixa</p>
        <h2 className="text-3xl font-bold">{formatCurrency(saldo)}</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white p-4 rounded-xl border border-gray-100">
          <div className="flex items-center gap-2 mb-2 text-green-600">
            <ArrowUpRight className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase">Entradas</span>
          </div>
          <p className="text-lg font-bold text-gray-900">{formatCurrency(entradas)}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-100">
          <div className="flex items-center gap-2 mb-2 text-red-600">
            <ArrowDownRight className="w-4 h-4" />
            <span className="text-xs font-semibold uppercase">Saídas</span>
          </div>
          <p className="text-lg font-bold text-gray-900">{formatCurrency(saidas)}</p>
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-gray-100">
        <h3 className="font-semibold text-sm mb-4">Fluxo de Caixa</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
              <Tooltip cursor={{ fill: '#f3f4f6' }} />
              <Bar dataKey="entradas" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={30} />
              <Bar dataKey="saidas" fill="#dc2626" radius={[4, 4, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-sm mb-3 text-gray-900">Lançamentos Recentes</h3>
        <div className="space-y-2">
          {lista.map((item, idx) => {
            if (item.kind === 'avulso') {
              const t = item.transacao;
              return (
                <div key={t.id} className="bg-white p-3 rounded-xl border border-gray-100 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${t.tipo === 'entrada' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                    {t.tipo === 'entrada' ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{t.descricao}</p>
                    <p className="text-xs text-gray-500">{t.categoria} • {formatDate(t.data)}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <p className={`text-sm font-bold ${t.tipo === 'entrada' ? 'text-green-600' : 'text-red-600'}`}>
                      {t.tipo === 'entrada' ? '+' : '-'}{formatCurrency(t.valor)}
                    </p>
                    <button onClick={() => deletar(t.id)} className="text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            }

            const { grupo } = item;
            const aberto = expandidos.has(grupo.key);
            const ordenados = [...grupo.itens].sort((a, b) => new Date(a.data).getTime() - new Date(b.data).getTime());

            return (
              <div key={grupo.key + idx} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {/* Linha do grupo */}
                <div className="flex items-center gap-3 p-3">
                  <button
                    onClick={() => toggleExpandir(grupo.key)}
                    className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${grupo.tipo === 'entrada' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}
                  >
                    {grupo.tipo === 'entrada' ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                  </button>
                  <button className="flex-1 min-w-0 text-left" onClick={() => toggleExpandir(grupo.key)}>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-gray-900 truncate">{grupo.base}</p>
                      <span className="flex-shrink-0 text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                        {grupo.itens.length}×
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{grupo.categoria} • {grupo.itens.length} parcelas</p>
                  </button>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <p className={`text-sm font-bold ${grupo.tipo === 'entrada' ? 'text-green-600' : 'text-red-600'}`}>
                      {grupo.tipo === 'entrada' ? '+' : '-'}{formatCurrency(grupo.valorTotal)}
                    </p>
                    <button
                      onClick={() => deletarGrupo(grupo.itens.map(i => i.id))}
                      className="text-gray-400 hover:text-red-500"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button onClick={() => toggleExpandir(grupo.key)} className="text-gray-400">
                      {aberto ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Parcelas expandidas */}
                {aberto && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {ordenados.map((t, i) => (
                      <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50/60">
                        <span className="text-[11px] text-gray-400 w-5 text-center font-medium flex-shrink-0">{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-gray-700 truncate">{t.descricao}</p>
                          <p className="text-[11px] text-gray-400">{formatDate(t.data)}</p>
                        </div>
                        <p className={`text-xs font-bold flex-shrink-0 ${t.tipo === 'entrada' ? 'text-green-600' : 'text-red-600'}`}>
                          {t.tipo === 'entrada' ? '+' : '-'}{formatCurrency(t.valor)}
                        </p>
                        <button onClick={() => deletar(t.id)} className="text-gray-300 hover:text-red-500 flex-shrink-0">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {transacoes.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">Nenhum lançamento encontrado.</p>
          )}
        </div>
      </div>
    </div>
  );
}
