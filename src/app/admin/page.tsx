import type { Metadata } from "next";
import { Coque } from "@/components/coque/coque";
import { TableauComptes } from "./tableau";

export const metadata: Metadata = { title: "Comptes" };

export default function PageAdmin() {
  return (
    <Coque>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
          <TableauComptes />
        </div>
      </div>
    </Coque>
  );
}
