export default function Section({
  title,
  children,
  headingLevel = 2,
}: {
  title: string;
  children: React.ReactNode;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}) {
  const headings: Record<1|2|3|4|5|6, React.ElementType> = {
    1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6'
  };
  const HeadingTag = headings[headingLevel];

  return (
    <section className="mb-5">
      <HeadingTag className="text-lg font-medium mb-3">{title}</HeadingTag>
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
