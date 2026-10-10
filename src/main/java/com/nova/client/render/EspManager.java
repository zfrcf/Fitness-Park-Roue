package com.nova.client.render;

import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;

import java.util.function.Predicate;

/**
 * EspManager : centralise l'état ESP/glow pour les mixins de rendu.
 * Étant donné que le client utilise le glow vanilla (outline), on se contente
 * ici de publier un prédicat global consommé par EntityGlowMixin.
 */
public final class EspManager {
    private static final Minecraft mc = Minecraft.getInstance();

    /** Predicat global : true si l'entité doit briller. Rempli par les modules ESP. */
    private static Predicate<Entity> glowPredicate = e -> false;

    private EspManager() {}

    public static void setGlowPredicate(Predicate<Entity> p) {
        glowPredicate = p == null ? e -> false : p;
    }

    public static boolean shouldGlow(Entity e) {
        if (mc.player == null || e == null || e == mc.player) return false;
        try {
            return glowPredicate.test(e);
        } catch (Throwable t) {
            return false;
        }
    }
}
