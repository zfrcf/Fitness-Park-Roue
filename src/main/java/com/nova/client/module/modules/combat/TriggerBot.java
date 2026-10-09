package com.nova.client.module.modules.combat;

import com.nova.client.NovaClient;
import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.DoubleSetting;
import com.nova.client.settings.IntSetting;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.EntityHitResult;

import java.util.concurrent.ThreadLocalRandom;

/**
 * TriggerBot : attaque automatiquement l'entité sous le crosshair.
 * CPS humains (gaussienne), ignore les amis.
 */
public class TriggerBot extends Module {
    private final DoubleSetting range = addSetting(new DoubleSetting("Range", "Portée", 3.0, 1.0, 6.0));
    private final IntSetting cps = addSetting(new IntSetting("CPS", "Clics par seconde", 10, 1, 20));

    private int delay;

    public TriggerBot() { super("TriggerBot", "Attaque l'entité visée", Category.COMBAT); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.gameMode == null || mc.hitResult == null) return;
        if (delay-- > 0) return;
        if (!(mc.hitResult instanceof EntityHitResult hit)) return;
        if (!(hit.getEntity() instanceof LivingEntity target) || !target.isAlive()) return;
        if (mc.player.distanceTo(target) > range.get()) return;
        if (target instanceof Player p && NovaClient.friends().isFriend(p.getGameProfile().name())) return;

        mc.gameMode.attack(mc.player, target);
        mc.player.swing(InteractionHand.MAIN_HAND);
        double mean = 20.0 / cps.get();
        delay = Math.max(1, (int) Math.round(ThreadLocalRandom.current().nextGaussian() * mean * 0.25 + mean));
    }
}
