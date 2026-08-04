import { useAppData } from '@/hooks/use-app-data';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Info, LogOut, Settings, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function Mais() {
  const { perfil, togglePerfil, allData: { limparDados } } = useAppData();
  const { toast } = useToast();

  const handleLimpar = () => {
    if (confirm('Tem certeza que deseja apagar todos os dados? Isso não pode ser desfeito.')) {
      limparDados();
      toast({ title: 'Dados apagados', description: 'Todos os dados foram removidos.' });
    }
  };

  return (
    <div className="p-4 space-y-6">
      <h2 className="text-lg font-bold">Configurações e Mais</h2>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="p-4 flex items-center justify-between border-b border-gray-100">
          <div>
            <Label htmlFor="perfil-toggle" className="text-sm font-medium">Modo Pessoa Jurídica (PJ)</Label>
            <p className="text-xs text-gray-500 mt-0.5">Mude para PF para finanças pessoais</p>
          </div>
          <Switch id="perfil-toggle" checked={perfil === 'PJ'} onCheckedChange={togglePerfil} />
        </div>

        <button className="w-full p-4 flex items-center gap-3 text-sm text-gray-700 hover:bg-gray-50 text-left border-b border-gray-100">
          <Settings className="w-4 h-4 text-gray-400" />
          Preferências do Aplicativo
        </button>

        <button className="w-full p-4 flex items-center gap-3 text-sm text-gray-700 hover:bg-gray-50 text-left border-b border-gray-100">
          <Info className="w-4 h-4 text-gray-400" />
          Sobre o App (v1.0.0)
        </button>

        <button onClick={handleLimpar} className="w-full p-4 flex items-center gap-3 text-sm text-red-600 hover:bg-red-50 text-left">
          <Trash2 className="w-4 h-4" />
          Limpar Todos os Dados
        </button>
      </div>

      <Button variant="outline" className="w-full text-gray-600 gap-2">
        <LogOut className="w-4 h-4" /> Sair
      </Button>
    </div>
  );
}
