package com.nova.client.mixin;

import com.nova.client.module.modules.render.CameraClip;
import net.minecraft.client.Camera;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** CameraClip : la caméra 3e personne ignore la collision avec les blocs. */
@Mixin(Camera.class)
public class CameraClipMixin {
    @Inject(method = "getMaxZoom", at = @At("HEAD"), cancellable = true)
    private void novaclient$cameraClip(double startingDistance, CallbackInfoReturnable<Double> cir) {
        if (CameraClip.isActive()) {
            cir.setReturnValue(startingDistance);
        }
    }
}
