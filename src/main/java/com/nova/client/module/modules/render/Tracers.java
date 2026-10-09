package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;

/**
 * Tracers : lignes vers les joueurs. Implémentation via glowing vanilla
 * (fallback sûr) ; le rendu de lignes 3D custom peut être ajouté
 * dans un mixin de LevelRenderer sans casser la compat Iris.
 */
public class Tracers extends Module {
    public Tracers() { super("Tracers", "Marque les joueurs proches (glow)", Category.RENDER); }
}
