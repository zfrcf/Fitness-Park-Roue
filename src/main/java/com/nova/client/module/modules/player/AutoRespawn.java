package com.nova.client.module.modules.player;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;

/** AutoRespawn : respawn instantané à la mort. */
public class AutoRespawn extends Module {
    /** true tant que la demande de respawn n'a pas été envoyée pour cette mort. */
    private boolean pending = true;

    public AutoRespawn() { super("AutoRespawn", "Respawn automatique", Category.PLAYER); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player == null || mc.player.connection == null) return;
        if (mc.player.isAlive()) {
            pending = true; // réarme pour la prochaine mort
            return;
        }
        if (pending) {
            pending = false; // un seul packet par mort, pas un par tick
            mc.player.connection.send(new net.minecraft.network.protocol.game.ServerboundClientCommandPacket(
                    net.minecraft.network.protocol.game.ServerboundClientCommandPacket.Action.PERFORM_RESPAWN));
        }
    }
}
