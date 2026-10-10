package com.nova.client.mixin;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.Hud;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Redirect;

/**
 * Injecte le rendu du HUD custom après l'extraction du HUD vanilla.
 * La méthode cible est `extractRenderState(DeltaTracker, boolean, boolean)`.
 * L'ancienne `render(...)` n'existe plus en MC 26.2 et provoque un crash du client.
 */
@Mixin(Gui.class)
public abstract class GuiMixin {
    @Redirect(method = "extractRenderState", at = @At(
            value = "INVOKE",
            target = "Lnet/minecraft/client/gui/Hud;extractRenderState(Lnet/minecraft/client/gui/GuiGraphicsExtractor;Lnet/minecraft/client/DeltaTracker;)V"))
    private void novaclient$renderHud(Hud hud, GuiGraphicsExtractor extractor, DeltaTracker tracker) {
        try {
            hud.extractRenderState(extractor, tracker);
        } finally {
            Minecraft mc = Minecraft.getInstance();
            if (mc != null && extractor != null) {
                try {
                    com.nova.client.gui.HudRenderer.render(extractor, mc.getWindow().getGuiScaledWidth(), mc.getWindow().getGuiScaledHeight());
                } catch (Throwable ignored) {}
            }
        }
    }
}
