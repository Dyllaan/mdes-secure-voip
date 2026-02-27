export default function Page({ children, className = "" }: { children: React.ReactNode, className?: string }) {
  return (
    <div className={`h-screen w-full ${className}`}>
      {children}
    </div>
  );
}