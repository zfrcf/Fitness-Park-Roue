package com.nova.client.gui;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import org.lwjgl.glfw.GLFW;

/**
 * HUD : gère l'ouverture de la ClickGUI sur RSHIFT.
 * N'accède PAS à mc.screen (champ supprimé en 26.2) : on suit nous-mêmes
 * l'état d'ouverture via une référence statique à notre écran.
 */
public class HudRenderer {
    /** GUI actuellement ouverte (null = aucune). */
    private static ClickGuiScreen open;
    private boolean wasDown;

    public void register() {
        ClientTickEvents.END_CLIENT_TICK.register(mc -> {
            if (mc.getWindow() == null) return;
            boolean down = GLFW.glfwGetKey(mc.getWindow().handle(), GLFW.GLFW_KEY_RIGHT_SHIFT) == GLFW.GLFW_PRESS;
            // Front montant uniquement, et seulement si notre GUI n'est pas déjà ouverte
            if (down && !wasDown && open == null) {
                open = new ClickGuiScreen();
                mc.setScreen(open);
            }
            wasDown = down;
        });
    }

    /** Appelé par ClickGuiScreen.onClose() pour libérer la référence. */
    public static void onGuiClosed() { open = null; }
}
