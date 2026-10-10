package com.nova.client.module.modules.render;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.IntSetting;
import com.nova.client.settings.ModeSetting;
import net.minecraft.core.BlockPos;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Base des ESP de blocs : scan périodique + stockage des positions.
 * Le rendu 3D custom ayant changé en 26.2, les positions sont exposées
 * via getFound() et affichées par le module Waypoints/beacons natifs.
 */
public abstract class AbstractBlockEsp extends Module {
    public enum EspColor {
        RED(255, 40, 40), GREEN(40, 255, 40), BLUE(60, 120, 255),
        YELLOW(255, 255, 40), CYAN(40, 255, 255), WHITE(255, 255, 255), ORANGE(255, 150, 0);
        public final int r, g, b;
        EspColor(int r, int g, int b) { this.r = r; this.g = g; this.b = b; }
    }

    protected final IntSetting rangeChunks = addSetting(new IntSetting("Range", "Rayon en chunks", 2, 1, 6));
    protected final ModeSetting<EspColor> color = addSetting(new ModeSetting<>("Color", "Couleur", EspColor.CYAN, EspColor.class));

    protected final Set<BlockPos> found = ConcurrentHashMap.newKeySet();
    private int timer;

    protected AbstractBlockEsp(String name, String desc) { super(name, desc, Category.RENDER); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.level == null) return;
        if (timer-- > 0) return;
        timer = 40; // scan toutes les 2 s
        found.clear();
        try { scan(); } catch (Throwable ignored) {}
    }

    protected abstract void scan();

    protected void add(BlockPos p) {
        if (found.size() < 2048) found.add(p.immutable());
    }

    /** Positions trouvées (lecture seule pour l'affichage). */
    public Set<BlockPos> getFound() { return found; }

    @Override
    protected void onDisable() { found.clear(); }
}
