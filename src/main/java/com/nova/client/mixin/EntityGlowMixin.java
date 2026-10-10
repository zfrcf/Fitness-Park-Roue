package com.nova.client.mixin;

import com.nova.client.module.modules.render.Esp;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Force le glow vanilla pour l'ESP/Tracers (pipeline de rendu vanilla, compatible Iris). */
@Mixin(Entity.class)
public class EntityGlowMixin {
    @Inject(method = "isCurrentlyGlowing", at = @At("HEAD"), cancellable = true)
    private void novaclient$espGlow(CallbackInfoReturnable<Boolean> cir) {
        if (Esp.shouldGlow((Entity) (Object) this)) {
            cir.setReturnValue(true);
        }
    }
}
