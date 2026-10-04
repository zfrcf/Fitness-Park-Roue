import type { Metadata } from "next";
import { Coque } from "@/components/coque/coque";
import { TableauEtat } from "./tableau";

export const metadata: Metadata = { title: "État des fournisseurs" };

export default function PageEtat() {
  return (
    <Coque>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
          <TableauEtat />
        </div>
      </div>
    </Coque>
  );
}
