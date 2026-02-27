export default function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-screen overflow-hidden flex">
      <div className="container mx-auto py-8 px-4">
        {children}
      </div>
    </div>
  );
}