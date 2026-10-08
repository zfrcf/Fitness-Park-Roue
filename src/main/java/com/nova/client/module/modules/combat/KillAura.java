package com.nova.client.module.modules.combat;

import com.nova.client.NovaClient;
import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;
import com.nova.client.settings.DoubleSetting;
import com.nova.client.settings.IntSetting;
import com.nova.client.settings.ModeSetting;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.entity.player.Player;

import java.util.Comparator;
import java.util.concurrent.ThreadLocalRandom;

/**
 * KillAura avec délai randomisé (gaussienne) et CPS humains
 * pour contourner les anti-cheats courants.
 */
public class KillAura extends Module {
    public enum Priority { CLOSEST, LOWEST_HEALTH }

    private final DoubleSetting range = addSetting(new DoubleSetting("Range", "Portée d'attaque", 3.0, 1.0, 6.0));
    private final IntSetting cps = addSetting(new IntSetting("CPS", "Clics par seconde (moyenne)", 12, 1, 20));
    private final BoolSetting playersOnly = addSetting(new BoolSetting("PlayersOnly", "Ne cibler que les joueurs", true));
    private final ModeSetting<Priority> priority = addSetting(new ModeSetting<>("Priority", "Priorité de cible", Priority.CLOSEST, Priority.class));

    private int delay;

    public KillAura() { super("KillAura", "Attaque automatiquement les entités proches", Category.COMBAT); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.level == null || mc.gameMode == null) return;
        if (delay > 0) { delay--; return; }

        Entity target = java.util.stream.StreamSupport.stream(mc.level.entitiesForRendering().spliterator(), false)
                .filter(en -> en instanceof LivingEntity && en != mc.player && en.isAlive())
                .filter(en -> !playersOnly.get() || en instanceof Player)
                .filter(en -> !(en instanceof Player p && NovaClient.friends().isFriend(p.getGameProfile().name())))
                .filter(en -> mc.player.distanceTo(en) <= range.get())
                .min(comparator())
                .orElse(null);
        if (target == null) return;

        // Rotation douce vers la cible (GCD-friendly : pas de snap instantané)
        var look = mc.player.getLookAngle();
        double dx = target.getX() - mc.player.getX();
        double dz = target.getZ() - mc.player.getZ();
        float yaw = (float) (Math.toDegrees(Math.atan2(dz, dx)) - 90.0);
        mc.player.setYRot(mc.player.getYRot() + (yaw - mc.player.getYRot()) * 0.4f);

        mc.gameMode.attack(mc.player, target);
        mc.player.swing(InteractionHand.MAIN_HAND);

        // Délai gaussien autour de 20/CPS ticks — pattern humain
        double mean = 20.0 / cps.get();
        delay = Math.max(1, (int) Math.round(ThreadLocalRandom.current().nextGaussian() * mean * 0.25 + mean));
    }

    private Comparator<Entity> comparator() {
        return priority.get() == Priority.CLOSEST
                ? Comparator.comparingDouble(en -> mc.player.distanceTo(en))
                : Comparator.comparingDouble(en -> en instanceof LivingEntity le ? le.getHealth() : Float.MAX_VALUE);
    }
}
