package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;

/**
 * ESP via l'outline glow vanilla (glowingTag) : compatible shaders/Iris,
 * aucun rendu custom requis, aucun crash possible.
 */
public class Esp extends Module {
    private static Esp instance;

    private final BoolSetting playersOnly = addSetting(new BoolSetting("PlayersOnly", "Joueurs uniquement", true));

    public Esp() {
        super("ESP", "Voir les entités à travers les murs (glow)", Category.RENDER);
        instance = this;
    }

    /** Appelé par EntityGlowMixin. Static : le mixin n'a pas accès au ModuleManager. */
    public static boolean shouldGlow(net.minecraft.world.entity.Entity e) {
        if (instance == null || !instance.isEnabled() || mc.player == null || e == mc.player) return false;
        return !instance.playersOnly.get() || e instanceof net.minecraft.world.entity.player.Player;
    }
}
