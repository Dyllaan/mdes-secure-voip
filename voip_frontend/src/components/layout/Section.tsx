export default function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-lg font-medium mb-3">{title}</h2>
      <div className="text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

export function SectionHeader({ title, updated }: { title: string; updated?: string }) {
  return (
    <div className="mb-6 space-y-2">
      <h1 className="text-3xl font-medium">{title}</h1>
      <p className="text-sm text-muted-foreground mb-6">Last updated: {updated}</p>
    </div>
  );
}