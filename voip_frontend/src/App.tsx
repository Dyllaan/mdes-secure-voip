import { ThemeProvider } from '@/components/theme/ThemeProvider';
import './App.css'
import AuthProvider from '@/components/auth/AuthProvider';
import ConnectionProvider from '@/components/providers/ConnectionProvider';
import { VoIPProvider } from "@/components/providers/VoIPProvider";
import Dashboard from "@/page/Dashboard";
import ServerList from '@/page/ServerList';
import ServerView from '@/page/ServerView';
import KeySetupPage from '@/page/KeySetupPage';
import { Routes, Route, BrowserRouter, Outlet } from 'react-router-dom';
import NotFound from './page/NotFound';
import AuthPage from "./page/AuthPage";
import ProtectedRoute from '@/components/auth/routes/ProtectedRoute';
import PublicRoute from '@/components/auth/routes/PublicRoute';
import KeysRequired from '@/components/auth/routes/KeysRequired';
import { Toaster } from "./components/ui/sonner";
import { useTheme } from 'next-themes';


function App() {

  const { theme } = useTheme();
  const toasterTheme = theme as "light" | "dark" | "system" | undefined;

  return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
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

                {/* Key setup — inside auth guard but before ConnectionProvider */}
                <Route path="/keys" element={<KeySetupPage />} />

                {/* All app routes — gated by IDB keypair check */}
                <Route element={<KeysRequired />}>
                  <Route element={
                    <ConnectionProvider>
                      <VoIPProvider>
                        <Outlet />
                      </VoIPProvider>
                    </ConnectionProvider>
                  }>
                    <Route path="/" element={<ServerList />} />
                    <Route path="/servers/:serverId" element={<ServerView />} />
                    <Route path="/servers/:serverId/channels/:channelId" element={<ServerView />} />
                    <Route path="/call" element={<Dashboard />} />
                  </Route>
                </Route>

              </Route>

              {/* 404 - accessible to everyone */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            <Toaster theme={toasterTheme} position="top-right"/>
          </AuthProvider>
        </BrowserRouter>
      </ThemeProvider>
  )
}

export default App
