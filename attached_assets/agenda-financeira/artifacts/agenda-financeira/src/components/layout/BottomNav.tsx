import { Link, useLocation } from 'wouter';
import { Home, Wallet, Plus, PieChart, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BottomNav() {
  const [location] = useLocation();

  const navItems = [
    { href: '/', icon: Home, label: 'Painel' },
    { href: '/caixa', icon: Wallet, label: 'Caixa' },
    { href: '/novo', icon: Plus, label: 'Novo', isFab: true },
    { href: '/relatorios', icon: PieChart, label: 'Relatórios' },
    { href: '/mais', icon: Menu, label: 'Mais' },
  ];

  return (
    <div className="bg-white border-t border-gray-200 px-2 py-2 flex justify-between items-center z-50 flex-shrink-0">
      {navItems.map((item) => {
        const isActive = location === item.href;
        
        if (item.isFab) {
          return (
            <Link key={item.href} href="/contas-receber" className="flex flex-col items-center justify-center relative -top-5">
              <div className="bg-primary text-white p-4 rounded-full shadow-lg flex items-center justify-center">
                <item.icon className="w-6 h-6" />
              </div>
            </Link>
          );
        }

        return (
          <Link key={item.href} href={item.href} className={cn("flex flex-col items-center justify-center w-16 gap-1", isActive ? "text-primary" : "text-gray-500")}>
            <item.icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
