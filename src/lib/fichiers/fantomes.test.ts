import { describe, expect, it } from "vitest";
import { fusionnerProjetDetaille, masquerFichiersConnus, modificationsFantomes, NOTE_APPLICATION } from "./projet";

const A = "src/main/java/com/exemple/Mod.java";
const base = { id: "a1", role: "assistant", parts: [{ type: "text", text: `\`\`\`java ${A}\nclass Mod {\n    void m() {\n        dire("Bonjour");\n    }\n}\n\`\`\`` }] };

describe("blocs modif mal formés par les modèles (cas réels)", () => {
  it("un « ======= » de trop avant la fin ne corrompt pas le fichier (NVIDIA)", () => {
    const modif = {
      id: "a2",
      role: "assistant",
      parts: [{ type: "text", text: `\`\`\`modif ${A}\n<<<<<<< CHERCHER\n        dire("Bonjour");\n=======\n        dire("Salut");\n=======\n>>>>>>> REMPLACER\n\`\`\`` }],
    };
    const { fichiers, echecs } = fusionnerProjetDetaille([base, modif]);
    expect(echecs).toEqual([]);
    expect(fichiers[0].contenu).toContain('dire("Salut");');
    expect(fichiers[0].contenu).not.toContain("=======");
  });

  it("une modification annoncée mais non écrite (note recopiée, Groq) est signalée comme échec", () => {
    const fantome = { id: "a3", role: "assistant", parts: [{ type: "text", text: `[modification de \`${A}\` : appliquée, voir l'état du projet]\n\nLa commande est ajoutée.` }] };
    const { echecs } = fusionnerProjetDetaille([base, fantome]);
    expect(echecs).toEqual([{ messageId: "a3", chemin: A, raison: expect.stringContaining("non écrite") }]);
  });

  it("les nouvelles notes de l'historique sont reconnues si le modèle les recopie", () => {
    const note = masquerFichiersConnus(`\`\`\`modif ${A}\n<<<<<<< CHERCHER\nx\n=======\ny\n>>>>>>> REMPLACER\n\`\`\``, new Set([A]));
    expect(note.startsWith(NOTE_APPLICATION)).toBe(true);
    expect(modificationsFantomes(note, new Set())).toEqual([A]);
    expect(modificationsFantomes(note, new Set([A]))).toEqual([]); // un vrai bloc pour ce fichier : pas de fantôme
  });
});
