package com.nova.client.module.modules.combat;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.Vec3;

/**
 * Surround : entoure le joueur d'obsidienne pour se protéger des cristaux.
 */
public class Surround extends Module {
    private final BoolSetting onlyInHole = addSetting(new BoolSetting("OnlyInHole", "Actif seulement hors trou", false));

    public Surround() { super("Surround", "Entoure le joueur d'obsidienne", Category.COMBAT); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.level == null || mc.gameMode == null) return;
        // OnlyInHole : si déjà protégé dans un trou, inutile de poser
        if (onlyInHole.get() && com.nova.client.util.CombatUtil.isInHole(mc.player)) return;
        BlockPos pos = mc.player.blockPosition();
        BlockPos[] around = {pos.north(), pos.south(), pos.east(), pos.west()};

        for (BlockPos p : around) {
            if (!mc.level.getBlockState(p).isAir()) continue;
            int slot = findObsidian();
            if (slot < 0) return;
            int old = mc.player.getInventory().getSelectedSlot();
            mc.player.getInventory().setSelectedSlot(slot);
            mc.gameMode.useItemOn(mc.player, InteractionHand.MAIN_HAND,
                    new BlockHitResult(Vec3.atCenterOf(p.below()), Direction.UP, p.below(), false));
            mc.player.swing(InteractionHand.MAIN_HAND);
            mc.player.getInventory().setSelectedSlot(old);
            return; // un bloc par tick : pattern vanilla
        }
    }

    private int findObsidian() {
        Inventory inv = mc.player.getInventory();
        for (int i = 0; i < 9; i++) {
            if (inv.getItem(i).is(Items.OBSIDIAN)) return i;
        }
        return -1;
    }
}
