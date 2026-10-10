package com.nova.client.render;

import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.entity.monster.Monster;
import net.minecraft.world.entity.player.Player;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Predicate;

/**
 * Décide si une entité doit briller (glow vanilla) selon les modules ESP actifs.
 * Consulté par EntityGlowMixin.
 */
public final class EspManager {
    private static final List<Predicate<Entity>> RULES = new CopyOnWriteArrayList<>();

    private EspManager() {}

    public static void addRule(Predicate<Entity> rule) { RULES.add(rule); }
    public static void removeRule(Predicate<Entity> rule) { RULES.remove(rule); }

    public static boolean shouldGlow(Entity e) {
        for (Predicate<Entity> r : RULES) {
            try { if (r.test(e)) return true; } catch (Throwable ignored) {}
        }
        return false;
    }

    // Helpers de classification
    public static boolean isPlayer(Entity e) { return e instanceof Player; }
    public static boolean isHostile(Entity e) { return e instanceof Monster; }
    public static boolean isItem(Entity e) { return e instanceof ItemEntity; }
}
