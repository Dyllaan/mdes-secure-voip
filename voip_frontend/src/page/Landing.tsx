import { Github } from 'lucide-react';
import { Link } from 'react-router-dom';
import config from '@/config/config';
import Page from '@/components/layout/Page';

export default function Landing() {
  const linkClass = "inline-flex items-center justify-center gap-2 px-5 py-2 rounded-md border-b border-border bg-background text-sm font-medium hover:bg-secondary transition";

  return (
    <Page header footer>
      <section className="mb-10">
        <h1 className="text-4xl font-medium leading-tight mb-4">
          End-to-end encrypted communication
        </h1>
        <p className="text-lg text-muted-foreground mb-8 max-w-xl">
          VoIP calls, screen sharing, encrypted messaging, and a YouTube music bot. Self-hostable and open source.
        </p>
        <div className="flex gap-3 flex-wrap">
          <Link to="/register" className={linkClass}>
            Create account
          </Link>
          <Link to="/login" className={linkClass}>
            Log in
          </Link>
          <a href={config.GITHUB_URL} target="_blank" rel="noreferrer" className={linkClass}>
            <Github className="w-4 h-4" />
            View on GitHub
          </a>
        </div>
      </section>
      <section className="mb-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          <Feature title="Encrypted by default" description="Signal Protocol for DMs. AES-GCM for rooms." />
          <Feature title="Voice and video" description="WebRTC peer-to-peer calls with screen sharing." />
          <Feature title="Music bot" description="Stream YouTube audio directly into voice channels." />
          <Feature title="Hubs and channels" description="Organise teams into hubs with invite links." />
          <Feature title="Desktop app" description="Electron client for Windows." />
          <Feature title="Open source" description="Self-host or contribute on GitHub." />
        </div>
      </section>
    </Page>
  );
}

function Feature({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <p className="font-medium mb-1">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}