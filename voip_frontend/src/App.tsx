import { ThemeProvider } from '@/components/theme/ThemeProvider';
import './App.css'
import AuthProvider from '@/components/auth/AuthProvider';
import ConnectionProvider from '@/components/providers/ConnectionProvider';
import { VoIPProvider } from "@/components/providers/VoIPProvider";
import HubList from '@/page/HubList';
import HubView from '@/page/HubView';
import KeySetupPage from '@/page/KeySetupPage';
import { Routes, Route, BrowserRouter, Outlet } from 'react-router-dom';
import NotFound from './page/NotFound';
import AuthPage from "./page/AuthPage";
import ProtectedRoute from '@/components/auth/routes/ProtectedRoute';
import PublicRoute from '@/components/auth/routes/PublicRoute';
import KeysRequired from '@/components/auth/routes/KeysRequired';
import { Toaster } from "./components/ui/sonner";
import { useTheme } from 'next-themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
function App() {

  const { theme } = useTheme();
  const toasterTheme = theme as "light" | "dark" | "system" | undefined;

  const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // fresh for 5 minutes
      retry: 1, // Only retry failed requests once
      refetchOnWindowFocus: false, // Don't refetch when user comes back to tab
      refetchOnMount: false,
    },
  },
});

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            {/* Public routes - only accessible when NOT authenticated */}
            <Route element={<PublicRoute />}>
              <Route path="/login" element={<AuthPage />} />
              <Route path="/register" element={<AuthPage mode="register" />} />
            </Route>
            {/* Protected routes - only accessible when authenticated */}
            <Route element={<ProtectedRoute />}>
              {/* Key setup - inside auth guard but before ConnectionProvider */}
              <Route path="/keys" element={<KeySetupPage />} />

              {/* All app routes - gated by IDB keypair check */}
              <Route element={<KeysRequired />}>
                <Route element={
                  <ConnectionProvider>
                    <VoIPProvider>
                      <Outlet />
                    </VoIPProvider>
                  </ConnectionProvider>
                }>
                  <Route path="/" element={<HubList />} />
                  <Route path="/hubs/:hubId" element={<HubView />} />
                  <Route path="/hubs/:hubId/channels/:channelId" element={<HubView />} />
                </Route>
              </Route>

            </Route>

            {/* 404 - accessible to everyone */}
            <Route path="*" element={<NotFound />} />
          </Routes>
          <Toaster theme={toasterTheme} position="top-right"/>
        </AuthProvider>
      </BrowserRouter>
      </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
