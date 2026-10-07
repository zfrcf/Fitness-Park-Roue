import { describe, expect, it } from "vitest";
import { consigneRelance } from "./relance";

const ANNONCE =
  "Je corrige les points d'API 26.2. Je dois vérifier les noms d'API exacts pour 26.2. Je corrige avec les hypothèses les plus probables pour la 26.x. Je vais vérifier une dernière fois les noms exacts pour la 26.2.";

describe("relance d'une réponse sans action", () => {
  it("relance le cas réel : demande de modification, réponse qui annonce sans écrire", () => {
    expect(consigneRelance("modifie les fichiers maintenant au lieu de parler", ANNONCE, true)).toMatch(/MAINTENANT/);
    expect(consigneRelance("corrige l'erreur de compilation", "Le problème vient de GuiGraphics.", true)).not.toBeNull();
  });

  it("ne relance pas une réponse qui modifie des fichiers", () => {
    const modif = "Voici la correction :\n\n```modif src/A.java\n<<<<<<< CHERCHER\nint a;\n=======\nint b;\n>>>>>>> REMPLACER\n```";
    expect(consigneRelance("corrige", modif, true)).toBeNull();
    expect(consigneRelance("ajoute un fichier", "```java src/B.java\nclass B {}\n```", true)).toBeNull();
  });

  it("ne relance pas sans projet, ni une simple question", () => {
    expect(consigneRelance("corrige", ANNONCE, false)).toBeNull();
    expect(consigneRelance("pourquoi ça ne compile pas ?", "Parce que la classe a été renommée en 26.2.", true)).toBeNull();
    expect(consigneRelance("merci !", "Avec plaisir.", true)).toBeNull();
  });
});
