import { ThemeToggle } from "@/components/theme-toggle";

export const metadata = {
  title: "LiveKit Cloud",
  description: "LiveKit Cloud — Sign in to your account",
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed right-4 top-4 z-50">
        <ThemeToggle />
      </div>
      {children}
    </>
  );
}
