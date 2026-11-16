export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-oboya-soft-white px-4 py-12">
      {children}
    </main>
  );
}
