import { ThemeProvider } from '@/components/theme/ThemeProvider';
import './App.css'
import AuthProvider from '@/components/auth/AuthProvider';
import ConnectionProvider from '@/components/providers/ConnectionProvider';
import { VoIPProvider } from "@/components/providers/VoIPProvider";
import HubList from '@/page/HubList';
import HubView from '@/page/HubView';
import KeySetupPage from '@/page/KeySetupPage';
import { Routes, Route, HashRouter, Outlet } from 'react-router-dom';
import NotFound from './page/NotFound';
import AuthPage from "./page/AuthPage";
import ProtectedRoute from '@/components/auth/routes/ProtectedRoute';
import PublicRoute from '@/components/auth/routes/PublicRoute';
import KeysRequired from '@/components/auth/routes/KeysRequired';
import { Toaster } from "./components/ui/sonner";
import { useTheme } from 'next-themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from './components/ui/tooltip';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
    },
  },
})

function ToasterWrapper() {
  const { theme } = useTheme()
  const toasterTheme = theme as "light" | "dark" | "system" | undefined
  return <Toaster theme={toasterTheme} position="top-right" />
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <HashRouter>
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
              <ToasterWrapper />
            </AuthProvider>
          </HashRouter>
      </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App