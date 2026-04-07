export default function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h2 className="text-lg font-medium mb-3">{title}</h2>
      <div className="text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

export function SectionHeader({ title, updated, icon }: { title: string; updated?: string, icon?: React.ReactNode }) {
  return (
    <div className="mb-6 space-y-2">
      <h1 className="text-3xl font-medium">{title}</h1>
      {icon && <div className="flex items-center gap-2">{icon}</div>}
      {updated && <p className="text-sm text-muted-foreground mb-6">Last updated: {updated}</p>}
    </div>
  );
}