package com.nova.client.module.modules.player;

import com.nova.client.event.EventHandler;
import com.nova.client.event.events.TickEvent;
import com.nova.client.module.Category;
import com.nova.client.module.Module;

/** AutoRespawn : respawn instantané à la mort. */
public class AutoRespawn extends Module {
    public AutoRespawn() { super("AutoRespawn", "Respawn automatique", Category.PLAYER); }

    @EventHandler
    public void onTick(TickEvent e) {
        if (mc.player != null && !mc.player.isAlive() && mc.player.connection != null) {
            mc.player.connection.send(new net.minecraft.network.protocol.game.ServerboundClientCommandPacket(
                    net.minecraft.network.protocol.game.ServerboundClientCommandPacket.Action.PERFORM_RESPAWN));
        }
    }
}
