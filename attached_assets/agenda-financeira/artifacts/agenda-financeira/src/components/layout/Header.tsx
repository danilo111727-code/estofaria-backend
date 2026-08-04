import { Bell, Landmark } from 'lucide-react';
import { useAppData } from '@/hooks/use-app-data';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export function Header() {
  const { perfil, togglePerfil } = useAppData();

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10 sticky top-0">
      <div className="flex items-center gap-2">
        <div className="bg-primary/10 p-2 rounded-lg text-primary">
          <Landmark className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-sm leading-tight text-gray-900">Agenda Financeira</h1>
          <p className="text-xs text-gray-500 font-medium">Pessoa {perfil === 'PJ' ? 'Jurídica' : 'Física'}</p>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        <button className="text-gray-500 relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
        </button>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="outline-none">
              <Avatar className="w-8 h-8 bg-gray-100 border border-gray-200">
                <AvatarFallback className="text-xs font-bold text-gray-700 bg-gray-100">{perfil}</AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={togglePerfil} className="cursor-pointer">
              Trocar para {perfil === 'PJ' ? 'PF' : 'PJ'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
