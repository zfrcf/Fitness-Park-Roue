import type { Metadata } from "next";
import { Entete } from "@/components/coque/entete";
import { TableauEtat } from "./tableau";

export const metadata: Metadata = { title: "État des fournisseurs" };

export default function PageEtat() {
  return (
    <main className="flex flex-1 flex-col">
      <Entete />
      <div className="mx-auto w-full max-w-4xl flex-1 p-4 sm:p-6">
        <TableauEtat />
      </div>
    </main>
  );
}
