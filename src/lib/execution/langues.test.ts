import { describe, expect, it } from "vitest";
import { langueExecutable, tronquerSortie } from "./langues";

describe("langages exécutables dans le navigateur", () => {
  it("reconnaît Python sous ses variantes", () => {
    for (const l of ["py", "python", "Python3", "PY3"]) expect(langueExecutable(l)).toBe("python");
    for (const l of ["js", "bash", "sh", "java", undefined, ""]) expect(langueExecutable(l)).toBeNull();
  });
  it("tronque une sortie trop longue", () => {
    expect(tronquerSortie("a\n".repeat(1000), 10)).toContain("lignes de plus");
    expect(tronquerSortie("x".repeat(100_000), 400, 1000)).toContain("tronquée");
    expect(tronquerSortie("ok")).toBe("ok");
  });
});
