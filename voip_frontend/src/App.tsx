import { ThemeProvider } from '@/components/theme/ThemeProvider';
import './App.css'
import AuthProvider from '@/components/auth/AuthProvider';
import Dashboard from "@/page/Dashboard";
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import NotFound from './page/NotFound';
import AuthPage from "./page/AuthPage";
import ProtectedRoute from '@/components/auth/routes/ProtectedRoute';
import PublicRoute from '@/components/auth/routes/PublicRoute';
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
                <Route path="/" element={<Dashboard />} />
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
