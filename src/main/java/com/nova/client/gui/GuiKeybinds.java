package com.nova.client.gui;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import org.lwjgl.glfw.GLFW;

import java.lang.reflect.Field;
import java.lang.reflect.Method;

/**
 * Détecte l'appui sur Right Shift et ouvre le ClickGui.
 * Utilise la réflexion pour accéder à l'écran courant : les noms de champs
 * de Minecraft changent entre versions, la réflexion trouve le bon champ
 * par son type (Screen) sans dépendre du nom exact en 26.2.
 */
public final class GuiKeybinds {
    private static boolean wasPressed = false;
    private static Field screenField;      // champ de type Screen dans Minecraft
    private static Method setScreenMethod; // méthode prenant un Screen

    private GuiKeybinds() {}

    public static void register() {
        resolveScreenAccess();
        ClientTickEvents.END_CLIENT_TICK.register(GuiKeybinds::onTick);
    }

    /** Trouve le champ Screen et la méthode setScreen par leur signature, pas leur nom. */
    private static void resolveScreenAccess() {
        for (Field f : Minecraft.class.getDeclaredFields()) {
            if (Screen.class.isAssignableFrom(f.getType())) {
                f.setAccessible(true);
                screenField = f;
                break;
            }
        }
        for (Method m : Minecraft.class.getDeclaredMethods()) {
            if (m.getParameterCount() == 1 && Screen.class.isAssignableFrom(m.getParameterTypes()[0])
                    && m.getReturnType() == void.class) {
                m.setAccessible(true);
                setScreenMethod = m;
                break;
            }
        }
    }

    private static Screen currentScreen(Minecraft mc) {
        try {
            return screenField != null ? (Screen) screenField.get(mc) : null;
        } catch (Exception e) {
            return null;
        }
    }

    private static void openScreen(Minecraft mc, Screen s) {
        try {
            if (setScreenMethod != null) setScreenMethod.invoke(mc, s);
        } catch (Exception e) {
            com.nova.client.NovaClient.LOGGER.error("Impossible d'ouvrir le GUI", e);
        }
    }

    private static void onTick(Minecraft mc) {
        if (mc.getWindow() == null || mc.player == null) {
            wasPressed = false;
            return;
        }
        long handle = mc.getWindow().handle();
        boolean pressed = GLFW.glfwGetKey(handle, GLFW.GLFW_KEY_RIGHT_SHIFT) == GLFW.GLFW_PRESS;
        if (pressed && !wasPressed) {
            if (currentScreen(mc) == null) {
                openScreen(mc, new ClickGuiScreen());
            }
        }
        wasPressed = pressed;
    }
}
