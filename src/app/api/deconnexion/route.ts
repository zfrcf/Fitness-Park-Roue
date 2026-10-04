import { NextResponse } from "next/server";
import { NOM_COOKIE, optionsCookie } from "@/lib/auth/session";

export async function POST() {
  const reponse = NextResponse.json({ ok: true });
  reponse.cookies.set(NOM_COOKIE, "", optionsCookie(0));
  return reponse;
}
