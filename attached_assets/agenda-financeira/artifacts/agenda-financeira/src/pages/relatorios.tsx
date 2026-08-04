import { PieChart as PieChartIcon, Activity } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

export default function Relatorios() {
  const data = [
    { name: 'Impostos', value: 400, color: '#ef4444' },
    { name: 'Serviços', value: 300, color: '#f97316' },
    { name: 'Equipamentos', value: 300, color: '#eab308' },
    { name: 'Marketing', value: 200, color: '#3b82f6' },
  ];

  return (
    <div className="p-4 space-y-6">
      <h2 className="text-lg font-bold">Relatórios</h2>
      
      <div className="bg-white p-4 rounded-xl border border-gray-100">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <PieChartIcon className="w-4 h-4 text-gray-500" />
          Gastos por Categoria
        </h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap gap-3 justify-center mt-2">
          {data.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-gray-600">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white p-4 rounded-xl border border-gray-100">
        <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-500" />
          Resumo do Trimestre
        </h3>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Total Entradas</span>
            <span className="font-semibold text-green-600">R$ 15.200,00</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Total Saídas</span>
            <span className="font-semibold text-red-600">R$ 4.800,00</span>
          </div>
          <div className="pt-2 border-t border-gray-100 flex justify-between font-bold">
            <span className="text-gray-900">Saldo Líquido</span>
            <span className="text-blue-600">R$ 10.400,00</span>
          </div>
        </div>
      </div>
    </div>
  );
}