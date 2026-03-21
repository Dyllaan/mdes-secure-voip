export default function Page({ title, subtitle, children}: { title: string, subtitle: string, children: React.ReactNode }) {
  return (
    <div className="h-screen flex flex-col items-center justify-center p-6">
            <div className="w-full max-w-md space-y-6">
                <div className="text-center space-y-2">
                    <h1 className="text-2xl font-bold">{title}</h1>
                    <p className="text-sm text-muted-foreground">
                        {subtitle}
                    </p>
                </div>
                {children}
            </div>
        </div>
  );
}