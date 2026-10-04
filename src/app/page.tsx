import { Entete } from "@/components/coque/entete";

export default function Accueil() {
  return (
    <main className="flex flex-1 flex-col">
      <Entete />
      <section className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Chat IA</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Le chat arrive à l&apos;étape 4. La page « État » est déjà fonctionnelle.
        </p>
      </section>
    </main>
  );
}
