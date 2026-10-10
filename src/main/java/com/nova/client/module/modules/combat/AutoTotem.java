package com.nova.client.module.modules.combat;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.IntSetting;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.Items;

import java.util.concurrent.ThreadLocalRandom;

/**
 * AutoTotem : place un totem en main secondaire dès qu'il est consommé.
 * Délais randomisés pour simuler un joueur humain.
 */
public class AutoTotem extends Module {
    private final IntSetting delay = addSetting(new IntSetting("Delay", "Ticks avant remplacement", 2, 0, 10));

    private int timer;

    public AutoTotem() { super("AutoTotem", "Remplace le totem en offhand automatiquement", Category.COMBAT); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.gameMode == null) return;
        if (mc.player.getOffhandItem().is(Items.TOTEM_OF_UNDYING)) return;
        if (timer-- > 0) return;

        Inventory inv = mc.player.getInventory();
        for (int slot = 0; slot < inv.getContainerSize(); slot++) {
            if (inv.getItem(slot).is(Items.TOTEM_OF_UNDYING)) {
                // Swap le totem du slot vers l'offhand (slot 40)
                var a = inv.getItem(slot);
                var b = inv.getItem(40);
                inv.setItem(slot, b);
                inv.setItem(40, a);
                timer = Math.max(0, (int) Math.round(ThreadLocalRandom.current().nextGaussian() * delay.get() * 0.3 + delay.get()));
                return;
            }
        }
    }
}
