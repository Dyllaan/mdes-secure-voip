import config from '@/config/config';
import { Github } from 'lucide-react';
import { Link } from 'react-router-dom';

function Header() {
  return (
    <nav className="flex justify-between items-center py-4 mb-4">
      <Link to="/">
        <span className="font-extrabold text-2xl font-mono">MDES</span>
      </Link>
      <a
        href={config.GITHUB_URL}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 text-sm border border-border rounded-md px-4 py-2 hover:bg-secondary transition"
      >
        <Github className="w-4 h-4" />
        GitHub
      </a>
    </nav>
    );
}

function Footer() {
  return (
    <footer>
      <div className="max-w-3xl mx-auto px-6 py-6 flex justify-between items-center flex-wrap gap-4">
        <p className="text-sm text-muted-foreground">&copy; 2026 MDES</p>
        <div className="flex gap-6 text-sm text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground transition">
            Privacy
          </Link>
          <Link to="/terms" className="hover:text-foreground transition">
            Terms
          </Link>
          <Link to={config.GITHUB_URL} target="_blank" rel="noreferrer" className="hover:text-foreground transition">
            GitHub
          </Link>
        </div>
      </div>
    </footer>
  );
}

export default function Page({ children, header, footer}: { children: React.ReactNode, header?: boolean, footer?: boolean }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="max-w-3xl mx-auto px-6 flex-1 w-full">
        {header && <Header />}
        {children}
      </main>
      {footer && <Footer />}
    </div>
  );
}