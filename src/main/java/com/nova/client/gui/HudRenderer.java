package com.nova.client.gui;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;

/**
 * HUD : stub pour 26.2.
 * Le rendu HUD complet (arraylist, watermark) sera ré-implémenté via un mixin
 * sur Gui.render() une fois la signature exacte confirmée par le build.
 * Pour l'instant : enregistrement sans effet visible.
 */
public class HudRenderer {
    private float hue;

    public void register() {
        // Placeholder : le rendu HUD sera ajouté via GuiMixin
        // (à implémenter après confirmation de la signature Gui.render() en 26.2)
    }
}
