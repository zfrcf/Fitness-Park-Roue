package com.nova.client.module.modules.combat;

import com.nova.client.NovaClient;
import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;
import com.nova.client.settings.DoubleSetting;
import com.nova.client.settings.IntSetting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.boss.enderdragon.EndCrystal;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

import java.util.Comparator;
import java.util.concurrent.ThreadLocalRandom;

/**
 * CrystalAura : pose et casse les cristaux automatiquement.
 * - Suicide-prevention : ne pose pas si le joueur est trop proche.
 * - Délais randomisés (gaussienne) et ordre de packets vanilla.
 */
public class CrystalAura extends Module {
    private final DoubleSetting range = addSetting(new DoubleSetting("Range", "Portée", 4.5, 1.0, 6.0));
    private final DoubleSetting placeRange = addSetting(new DoubleSetting("PlaceRange", "Portée de pose", 4.5, 1.0, 6.0));
    private final IntSetting breakDelay = addSetting(new IntSetting("BreakDelay", "Ticks entre casses", 2, 0, 20));
    private final IntSetting placeDelay = addSetting(new IntSetting("PlaceDelay", "Ticks entre poses", 2, 0, 20));
    private final BoolSetting antiSuicide = addSetting(new BoolSetting("AntiSuicide", "Ne pas se suicider", true));
    private final DoubleSetting minHealth = addSetting(new DoubleSetting("MinHealth", "Vie min pour poser", 6.0, 1.0, 36.0));

    private int breakTimer, placeTimer;

    public CrystalAura() { super("CrystalAura", "Pose/casse les cristaux automatiquement", Category.COMBAT); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.level == null || mc.gameMode == null) return;
        if (antiSuicide.get() && mc.player.getHealth() + mc.player.getAbsorptionAmount() < minHealth.get()) return;

        Player target = nearestEnemy();
        if (target == null) return;

        // 1) Casser les cristaux existants proches de la cible
        if (breakTimer-- <= 0) {
            EndCrystal crystal = java.util.stream.StreamSupport.stream(mc.level.entitiesForRendering().spliterator(), false)
                    .filter(en -> en instanceof EndCrystal)
                    .map(en -> (EndCrystal) en)
                    .filter(c -> mc.player.distanceTo(c) <= range.get())
                    .filter(c -> c.distanceTo(target) < 6.0)
                    .min(Comparator.comparingDouble(c -> mc.player.distanceTo(c)))
                    .orElse(null);
            if (crystal != null) {
                mc.gameMode.attack(mc.player, crystal);
                mc.player.swing(InteractionHand.MAIN_HAND);
                breakTimer = jitter(breakDelay.get());
            }
        }

        // 2) Poser un cristal sur obsidian/bedrock proche de la cible
        if (placeTimer-- <= 0 && mc.player.getMainHandItem().is(Items.END_CRYSTAL)) {
            BlockPos base = findPlacePos(target);
            if (base != null) {
                mc.gameMode.useItemOn(mc.player, InteractionHand.MAIN_HAND,
                        new BlockHitResult(Vec3.atCenterOf(base.above()), Direction.UP, base, false));
                mc.player.swing(InteractionHand.MAIN_HAND);
                placeTimer = jitter(placeDelay.get());
            }
        }
    }

    private BlockPos findPlacePos(Player target) {
        BlockPos center = target.blockPosition();
        BlockPos best = null;
        double bestDist = Double.MAX_VALUE;
        for (int dx = -4; dx <= 4; dx++) for (int dy = -2; dy <= 2; dy++) for (int dz = -4; dz <= 4; dz++) {
            BlockPos pos = center.offset(dx, dy, dz);
            var state = mc.level.getBlockState(pos);
            if (!state.is(net.minecraft.world.level.block.Blocks.OBSIDIAN)
                    && !state.is(net.minecraft.world.level.block.Blocks.BEDROCK)) continue;
            if (!mc.level.getBlockState(pos.above()).isAir()) continue;
            if (mc.player.distanceToSqr(Vec3.atCenterOf(pos)) > placeRange.get() * placeRange.get()) continue;
            // Anti-suicide : pas de pose à nos pieds si on est proche
            if (antiSuicide.get() && pos.distSqr(mc.player.blockPosition()) < 4) continue;
            double d = pos.distSqr(center);
            if (d < bestDist) { bestDist = d; best = pos; }
        }
        return best;
    }

    private Player nearestEnemy() {
        return java.util.stream.StreamSupport.stream(mc.level.entitiesForRendering().spliterator(), false)
                .filter(en -> en instanceof Player p && p != mc.player && p.isAlive())
                .map(en -> (Player) en)
                .filter(p -> !NovaClient.friends().isFriend(p.getGameProfile().name()))
                .filter(p -> mc.player.distanceTo(p) <= range.get() + 2)
                .min(Comparator.comparingDouble(p -> mc.player.distanceTo(p)))
                .orElse(null);
    }

    /** Délai gaussien autour de la valeur de base (pattern humain). */
    private int jitter(int base) {
        return Math.max(0, (int) Math.round(ThreadLocalRandom.current().nextGaussian() * base * 0.3 + base));
    }
}
