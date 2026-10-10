package com.nova.client.mixin;

import com.nova.client.render.EspManager;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * Active le glow vanilla (outline) sur les entités ciblées par l'ESP.
 */
@Mixin(Entity.class)
public abstract class EntityGlowMixin {
    @Inject(method = "isCurrentlyGlowing", at = @At("HEAD"), cancellable = true)
    private void novaclient$forceGlow(CallbackInfoReturnable<Boolean> cir) {
        Entity self = (Entity) (Object) this;
        if (EspManager.shouldGlow(self)) {
            cir.setReturnValue(true);
        }
    }
}
