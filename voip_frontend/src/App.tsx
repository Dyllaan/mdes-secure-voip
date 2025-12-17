import { ThemeProvider } from '@/components/theme/ThemeProvider';
import './App.css'
import { AuthProvider } from './hooks/useAuth';
import LoginOrDash from './components/auth/LoginOrDash';

function App() {

  return (
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <AuthProvider>
          <LoginOrDash />
        </AuthProvider>
      </ThemeProvider>
  )
}

export default App
