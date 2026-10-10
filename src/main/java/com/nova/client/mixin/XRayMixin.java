package com.nova.client.mixin;

import com.nova.client.module.modules.world.XRay;
import net.minecraft.world.level.block.state.BlockBehaviour;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** XRay : les blocs non listés n'occluent plus (rendus transparents). */
@Mixin(BlockBehaviour.BlockStateBase.class)
public abstract class XRayMixin {
    @Inject(method = "canOcclude", at = @At("HEAD"), cancellable = true)
    private void novaclient$xray(CallbackInfoReturnable<Boolean> cir) {
        if (XRay.isActive()) {
            BlockBehaviour.BlockStateBase self = (BlockBehaviour.BlockStateBase) (Object) this;
            if (!XRay.isVisible(self.getBlock())) {
                cir.setReturnValue(false);
            }
        }
    }
}
