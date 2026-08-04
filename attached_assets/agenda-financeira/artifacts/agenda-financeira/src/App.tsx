import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Caixa from "@/pages/caixa";
import ContasReceber from "@/pages/contas-receber";
import Relatorios from "@/pages/relatorios";
import Mais from "@/pages/mais";
import { AppLayout } from "@/components/layout/AppLayout";

const queryClient = new QueryClient();

function Router() {
  return (
    <div className="h-[100dvh] w-full bg-gray-200 flex justify-center overflow-hidden">
      <div className="w-full max-w-[430px] bg-background shadow-xl flex flex-col h-[100dvh]">
        <AppLayout>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/caixa" component={Caixa} />
            <Route path="/contas-receber" component={ContasReceber} />
            <Route path="/relatorios" component={Relatorios} />
            <Route path="/mais" component={Mais} />
            <Route component={NotFound} />
          </Switch>
        </AppLayout>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
