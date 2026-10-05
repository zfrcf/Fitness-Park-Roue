import type { Metadata } from "next";
import { Accueil } from "@/components/accueil/accueil";
import { Coque } from "@/components/coque/coque";

export const metadata: Metadata = { title: "Accueil" };
export const dynamic = "force-dynamic";

export default function PageAccueil() {
  return (
    <Coque>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
          <Accueil />
        </div>
      </div>
    </Coque>
  );
}
