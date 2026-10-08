package com.nova.client.mixin;

import com.nova.client.NovaClient;
import com.nova.client.event.events.PacketSendEvent;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.Packet;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Intercepte tous les packets sortants et les fait passer par l'EventBus. */
@Mixin(ClientPacketListener.class)
public class ClientPacketListenerMixin {
    @Inject(method = "send(Lnet/minecraft/network/protocol/Packet;)V", at = @At("HEAD"), cancellable = true)
    private void novaclient$onSendPacket(Packet<?> packet, CallbackInfo ci) {
        // Passe le packet par l'EventBus ; annulé => jamais envoyé au serveur
        PacketSendEvent event = NovaClient.events().post(new PacketSendEvent(packet));
        if (event.isCancelled()) {
            ci.cancel();
        }
    }
}
