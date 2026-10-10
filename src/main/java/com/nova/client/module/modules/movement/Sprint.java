package com.nova.client.module.modules.movement;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;

/** Sprint omnidirectionnel : sprint dès qu'on bouge, toutes directions. */
public class Sprint extends Module {
    public Sprint() { super("Sprint", "Sprint automatique omnidirectionnel", Category.MOVEMENT); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null) return;
        var keys = mc.player.input.keyPresses;
        if (keys.forward() || keys.left() || keys.right() || keys.backward()) {
            mc.player.setSprinting(true);
        }
    }
}
