import { MessageSquare } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Accueil() {
  return (
    <main className="flex flex-1 flex-col">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2 font-medium">
          <MessageSquare className="size-5" />
          Chat IA
        </div>
        <ThemeToggle />
      </header>
      <section className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Squelette prêt
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Étape 1 terminée : Next.js 16, Tailwind v4, shadcn/ui, thème clair et
          sombre. Le chat arrive aux étapes suivantes.
        </p>
      </section>
    </main>
  );
}
