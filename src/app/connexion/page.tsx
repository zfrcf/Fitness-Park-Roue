import type { Metadata } from "next";
import { Suspense } from "react";
import { FormulaireConnexion } from "./formulaire";

export const metadata: Metadata = { title: "Connexion" };

export default function PageConnexion() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Suspense>
        <FormulaireConnexion />
      </Suspense>
    </main>
  );
}
