package com.nova.client.gui;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import org.lwjgl.glfw.GLFW;

/**
 * Détecte l'appui sur Right Shift dans la boucle de tick et ouvre le ClickGui.
 * Aucune API Fabric de keybinding : on interroge GLFW directement,
 * ce qui est fiable sur toutes les versions de Minecraft.
 */
public final class GuiKeybinds {
    private static boolean wasPressed = false;

    private GuiKeybinds() {}

    public static void register() {
        ClientTickEvents.END_CLIENT_TICK.register(GuiKeybinds::onTick);
    }

    private static void onTick(Minecraft mc) {
        // Pas de fenêtre ou pas de joueur : on ignore
        if (mc.getWindow() == null || mc.player == null) {
            wasPressed = false;
            return;
        }
        long handle = mc.getWindow().handle();
        boolean pressed = GLFW.glfwGetKey(handle, GLFW.GLFW_KEY_RIGHT_SHIFT) == GLFW.GLFW_PRESS;
        if (pressed && !wasPressed) {
            // Ouvre seulement si aucun écran n'est déjà affiché
            if (mc.screen == null) {
                mc.setScreen(new ClickGuiScreen());
            }
        }
        wasPressed = pressed;
    }
}
