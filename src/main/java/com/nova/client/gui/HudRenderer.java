package com.nova.client.gui;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import org.lwjgl.glfw.GLFW;

/**
 * HUD : gère l'ouverture de la ClickGUI sur RSHIFT.
 * Le rendu HUD (watermark + arraylist) sera ré-implémenté une fois la
 * signature exacte de Gui.render() confirmée en 26.2 (voir crash report).
 * Aucun mixin GUI pour l'instant : stabilité garantie.
 */
public class HudRenderer {

    public void register() {
        ClientTickEvents.END_CLIENT_TICK.register(mc -> {
            if (mc.screen == null && mc.getWindow() != null
                    && GLFW.glfwGetKey(mc.getWindow().handle(), GLFW.GLFW_KEY_RIGHT_SHIFT) == GLFW.GLFW_PRESS) {
                mc.setScreen(new com.nova.client.gui.ClickGuiScreen());
            }
        });
    }
}
