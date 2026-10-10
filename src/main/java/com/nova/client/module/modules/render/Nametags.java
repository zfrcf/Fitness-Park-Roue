package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;
import com.nova.client.settings.DoubleSetting;

/**
 * Nametags : paramètres pour un rendu de nametags amélioré.
 * NOTE : le rendu custom des nametags nécessite un mixin du pipeline
 * d'entités (instable en 26.2 avec Sodium). Ce module expose les réglages.
 */
public class Nametags extends Module {
    public final DoubleSetting scale = addSetting(new DoubleSetting("Scale", "Taille", 1.0, 0.5, 3.0));
    public final BoolSetting showHealth = addSetting(new BoolSetting("ShowHealth", "Afficher la vie", true));
    public final BoolSetting showItems = addSetting(new BoolSetting("ShowItems", "Afficher les items", false));

    public Nametags() { super("Nametags", "Nametags améliorés (réglages)", Category.RENDER); }
}
