package com.nova.client.gui;

import com.nova.client.mixin.MinecraftAccessor;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import org.lwjgl.glfw.GLFW;

/**
 * Ouvre le ClickGui avec Right Shift.
 * Passe par un Invoker mixin (descripteur bytecode stable) plutôt que
 * la réflexion : aucun risque de cibler le mauvais champ/méthode.
 * On ne vérifie PAS l'écran courant : si un écran est ouvert, Minecraft
 * le remplace proprement ; le ClickGui se ferme avec Échap.
 */
public final class GuiKeybinds {
    private static boolean wasPressed = false;

    private GuiKeybinds() {}

    public static void register() {
        ClientTickEvents.END_CLIENT_TICK.register(GuiKeybinds::onTick);
    }

    private static void onTick(Minecraft mc) {
        if (mc.getWindow() == null || mc.player == null) {
            wasPressed = false;
            return;
        }
        long handle = mc.getWindow().handle();
        boolean pressed = GLFW.glfwGetKey(handle, GLFW.GLFW_KEY_RIGHT_SHIFT) == GLFW.GLFW_PRESS;
        if (pressed && !wasPressed) {
            ((MinecraftAccessor) mc).novaclient$setScreen(new ClickGuiScreen());
        }
        wasPressed = pressed;
    }
}
