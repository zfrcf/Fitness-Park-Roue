package com.nova.client.mixin;

import com.nova.client.module.modules.render.BreakEsp;
import net.minecraft.client.multiplayer.MultiPlayerGameMode;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** Alimente BreakESP : enregistre les blocs en cours de destruction. */
@Mixin(MultiPlayerGameMode.class)
public class BreakEspMixin {
    @Inject(method = "startDestroyBlock", at = @At("HEAD"))
    private void novaclient$startDestroy(BlockPos pos, Direction dir, CallbackInfoReturnable<Boolean> cir) {
        BreakEsp.record(pos);
    }

    @Inject(method = "continueDestroyBlock", at = @At("HEAD"))
    private void novaclient$continueDestroy(BlockPos pos, Direction dir, CallbackInfoReturnable<Boolean> cir) {
        BreakEsp.record(pos);
    }
}
