package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;

/**
 * ESP via l'outline glow vanilla (glowingTag) : compatible shaders/Iris,
 * aucun rendu custom requis, aucun crash possible.
 */
public class Esp extends Module {
    private final BoolSetting playersOnly = addSetting(new BoolSetting("PlayersOnly", "Joueurs uniquement", true));

    public Esp() { super("ESP", "Voir les entités à travers les murs (glow)", Category.RENDER); }

    public boolean shouldGlow(net.minecraft.world.entity.Entity e) {
        if (!isEnabled() || mc.player == null || e == mc.player) return false;
        return !playersOnly.get() || e instanceof net.minecraft.world.entity.player.Player;
    }
}
