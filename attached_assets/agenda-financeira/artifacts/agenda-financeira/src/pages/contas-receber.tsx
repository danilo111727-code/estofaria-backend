import { useState } from 'react';
import { useAppData } from '@/hooks/use-app-data';
import { formatCurrency, formatDate } from '@/lib/format';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

function parseParcela(nome: string): { base: string; atual: number; total: number } | null {
  const match = nome.match(/^(.+) \((\d+)\/(\d+)\)$/);
  if (match) return { base: match[1], atual: parseInt(match[2]), total: parseInt(match[3]) };
  return null;
}

function agrupar<T extends { id: string; valor: number; dataVencimento: string; status: string }>(
  itens: T[],
  getNome: (item: T) => string
) {
  const grupos: Map<string, { base: string; total: number; itens: T[] }> = new Map();
  const avulsos: T[] = [];

  for (const item of itens) {
    const p = parseParcela(getNome(item));
    if (p) {
      if (!grupos.has(p.base)) grupos.set(p.base, { base: p.base, total: p.total, itens: [] });
      grupos.get(p.base)!.itens.push(item);
    } else {
      avulsos.push(item);
    }
  }

  return { grupos: Array.from(grupos.values()), avulsos };
}

const statusLabel: Record<string, string> = {
  pendente: 'Pendente', recebido: 'Recebido', pago: 'Pago',
  parcial: 'Parcial', atrasado: 'Atrasado',
};
const statusCls: Record<string, string> = {
  recebido: 'bg-green-100 text-green-700',
  pago: 'bg-green-100 text-green-700',
  pendente: 'bg-yellow-100 text-yellow-700',
  parcial: 'bg-blue-100 text-blue-700',
  atrasado: 'bg-red-100 text-red-700',
};

function statusResumo(itens: { status: string }[]) {
  const pago = itens.filter(i => i.status === 'recebido' || i.status === 'pago').length;
  const total = itens.length;
  if (pago === total) return { label: `${pago}/${total} pago`, cls: 'bg-green-100 text-green-700' };
  if (pago > 0) return { label: `${pago}/${total} pago`, cls: 'bg-blue-100 text-blue-700' };
  const atrasado = itens.some(i => i.status === 'atrasado');
  if (atrasado) return { label: 'Atrasado', cls: 'bg-red-100 text-red-700' };
  return { label: `0/${total} pago`, cls: 'bg-yellow-100 text-yellow-700' };
}

export default function ContasReceber() {
  const { contasReceber, contasPagar } = useAppData();
  const [aba, setAba] = useState<'receber' | 'pagar'>('receber');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const toggleExpandir = (base: string) => {
    setExpandidos(prev => {
      const next = new Set(prev);
      if (next.has(base)) next.delete(base);
      else next.add(base);
      return next;
    });
  };

  const { grupos: gruposReceber, avulsos: avulsosReceber } = agrupar(contasReceber, c => c.cliente);
  const { grupos: gruposPagar, avulsos: avulsosPagar } = agrupar(contasPagar, c => c.fornecedor);

  const totalAba = aba === 'receber'
    ? contasReceber.filter(c => c.status !== 'recebido').reduce((a, c) => a + c.valor, 0)
    : contasPagar.filter(c => c.status !== 'pago').reduce((a, c) => a + c.valor, 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-bold">Contas</h2>
        <span className={`text-sm font-bold ${aba === 'receber' ? 'text-green-600' : 'text-red-600'}`}>
          {formatCurrency(totalAba)}
        </span>
      </div>

      {/* Abas */}
      <div className="flex bg-gray-100 rounded-xl p-1 gap-1">
        {[
          { id: 'receber', label: 'A Receber', count: contasReceber.filter(c => c.status !== 'recebido').length },
          { id: 'pagar', label: 'A Pagar', count: contasPagar.filter(c => c.status !== 'pago').length },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setAba(tab.id as any)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
              aba === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                aba === tab.id
                  ? (tab.id === 'receber' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')
                  : 'bg-gray-200 text-gray-500'
              }`}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Contas a Receber */}
      {aba === 'receber' && (
        <div className="space-y-3">
          {/* Grupos */}
          {gruposReceber.map(grupo => {
            const aberto = expandidos.has(grupo.base);
            const resumo = statusResumo(grupo.itens);
            const valorTotal = grupo.itens.reduce((a, c) => a + c.valor, 0);
            const proxima = [...grupo.itens].sort((a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())
              .find(i => i.status !== 'recebido');

            return (
              <div key={grupo.base} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 p-4 text-left"
                  onClick={() => toggleExpandir(grupo.base)}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                    resumo.cls.includes('green') ? 'bg-green-100 text-green-700' : resumo.cls.includes('red') ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {grupo.itens.length}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{grupo.base}</p>
                    <p className="text-xs text-gray-400">
                      {grupo.itens.length} parcelas • {proxima ? `Próx: ${formatDate(proxima.dataVencimento)}` : 'Todas pagas'}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 flex items-center gap-2">
                    <div>
                      <p className="text-sm font-bold text-green-600">{formatCurrency(valorTotal)}</p>
                      <Badge className={`text-[10px] border-none ${resumo.cls}`}>{resumo.label}</Badge>
                    </div>
                    {aberto ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </div>
                </button>

                {aberto && (
                  <div className="border-t border-gray-50 divide-y divide-gray-50">
                    {[...grupo.itens]
                      .sort((a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())
                      .map((c, i) => (
                        <div key={c.id} className="flex items-center gap-3 px-4 py-3 bg-gray-50/50">
                          <span className="text-[11px] text-gray-400 w-6 flex-shrink-0 text-center font-medium">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-500">{formatDate(c.dataVencimento)} • {c.formaPagamento}</p>
                          </div>
                          <span className="text-xs font-bold text-green-600">{formatCurrency(c.valor)}</span>
                          <Badge className={`text-[10px] border-none flex-shrink-0 ${statusCls[c.status] || ''}`}>
                            {statusLabel[c.status] || c.status}
                          </Badge>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Avulsos */}
          {avulsosReceber.map(c => (
            <div key={c.id} className="bg-white p-4 rounded-xl border border-gray-100 flex flex-col gap-2">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{c.cliente}</p>
                  <p className="text-xs text-gray-500">Vence: {formatDate(c.dataVencimento)}</p>
                </div>
                <Badge className={`border-none text-[11px] ${statusCls[c.status] || ''}`}>
                  {statusLabel[c.status] || c.status}
                </Badge>
              </div>
              <div className="flex justify-between items-end mt-2 pt-2 border-t border-gray-50">
                <span className="text-xs font-medium text-gray-500">{c.formaPagamento}</span>
                <span className="text-base font-bold text-gray-900">{formatCurrency(c.valor)}</span>
              </div>
            </div>
          ))}

          {contasReceber.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">Nenhuma conta a receber.</p>
          )}
        </div>
      )}

      {/* Contas a Pagar */}
      {aba === 'pagar' && (
        <div className="space-y-3">
          {/* Grupos */}
          {gruposPagar.map(grupo => {
            const aberto = expandidos.has(`pagar-${grupo.base}`);
            const resumo = statusResumo(grupo.itens);
            const valorTotal = grupo.itens.reduce((a, c) => a + c.valor, 0);
            const proxima = [...grupo.itens].sort((a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())
              .find(i => i.status !== 'pago');

            return (
              <div key={grupo.base} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <button
                  className="w-full flex items-center gap-3 p-4 text-left"
                  onClick={() => toggleExpandir(`pagar-${grupo.base}`)}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                    resumo.cls.includes('green') ? 'bg-green-100 text-green-700' : resumo.cls.includes('red') ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {grupo.itens.length}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{grupo.base}</p>
                    <p className="text-xs text-gray-400">
                      {grupo.itens.length} parcelas • {proxima ? `Próx: ${formatDate(proxima.dataVencimento)}` : 'Todas pagas'}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0 flex items-center gap-2">
                    <div>
                      <p className="text-sm font-bold text-red-600">{formatCurrency(valorTotal)}</p>
                      <Badge className={`text-[10px] border-none ${resumo.cls}`}>{resumo.label}</Badge>
                    </div>
                    {aberto ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  </div>
                </button>

                {aberto && (
                  <div className="border-t border-gray-50 divide-y divide-gray-50">
                    {[...grupo.itens]
                      .sort((a, b) => new Date(a.dataVencimento).getTime() - new Date(b.dataVencimento).getTime())
                      .map((c, i) => (
                        <div key={c.id} className="flex items-center gap-3 px-4 py-3 bg-gray-50/50">
                          <span className="text-[11px] text-gray-400 w-6 flex-shrink-0 text-center font-medium">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-gray-500">{formatDate(c.dataVencimento)} • {c.categoria}</p>
                          </div>
                          <span className="text-xs font-bold text-red-600">{formatCurrency(c.valor)}</span>
                          <Badge className={`text-[10px] border-none flex-shrink-0 ${statusCls[c.status] || ''}`}>
                            {statusLabel[c.status] || c.status}
                          </Badge>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Avulsos */}
          {avulsosPagar.map(c => (
            <div key={c.id} className="bg-white p-4 rounded-xl border border-gray-100 flex flex-col gap-2">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{c.fornecedor}</p>
                  <p className="text-xs text-gray-500">Vence: {formatDate(c.dataVencimento)}</p>
                </div>
                <Badge className={`border-none text-[11px] ${statusCls[c.status] || ''}`}>
                  {statusLabel[c.status] || c.status}
                </Badge>
              </div>
              <div className="flex justify-between items-end mt-2 pt-2 border-t border-gray-50">
                <span className="text-xs font-medium text-gray-500">{c.categoria}</span>
                <span className="text-base font-bold text-gray-900">{formatCurrency(c.valor)}</span>
              </div>
            </div>
          ))}

          {contasPagar.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-8">Nenhuma conta a pagar.</p>
          )}
        </div>
      )}
    </div>
  );
}
