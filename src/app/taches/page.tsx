import type { Metadata } from "next";
import { Coque } from "@/components/coque/coque";
import { TableauTaches } from "./tableau";

export const metadata: Metadata = { title: "Tâches de fond" };

export default function PageTaches() {
  return (
    <Coque>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
          <TableauTaches />
        </div>
      </div>
    </Coque>
  );
}
