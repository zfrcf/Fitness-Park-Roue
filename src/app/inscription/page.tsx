import type { Metadata } from "next";
import { FormulaireInscription } from "./formulaire";

export const metadata: Metadata = { title: "Créer un compte" };

export default function PageInscription() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <FormulaireInscription />
    </main>
  );
}
