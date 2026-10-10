package com.nova.client.mixin;

import com.nova.client.render.EspManager;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Fait briller les entités selon les modules ESP actifs (glow vanilla). */
@Mixin(Minecraft.class)
public class EntityGlowMixin {
    @Inject(method = "shouldEntityAppearGlowing", at = @At("RETURN"), cancellable = true)
    private void novaclient$glow(Entity entity, CallbackInfoReturnable<Boolean> cir) {
        if (!cir.getReturnValue() && EspManager.shouldGlow(entity)) {
            cir.setReturnValue(true);
        }
    }
}
