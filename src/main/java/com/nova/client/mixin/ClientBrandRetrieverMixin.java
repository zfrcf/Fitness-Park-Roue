package com.nova.client.mixin;

import com.nova.client.module.modules.misc.ClientSpoof;
import net.minecraft.client.ClientBrandRetriever;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * VanillaSpoofer : le serveur voit TOUJOURS le brand "vanilla".
 * Le brand custom "NovaClient" n'est affiché qu'en F3 local (voir ClientSpoof).
 */
@Mixin(ClientBrandRetriever.class)
public class ClientBrandRetrieverMixin {
    @Inject(method = "getClientModName", at = @At("HEAD"), cancellable = true)
    private static void novaclient$spoofBrand(CallbackInfoReturnable<String> cir) {
        if (ClientSpoof.isSpoofing()) {
            cir.setReturnValue("vanilla");
        }
    }
}
