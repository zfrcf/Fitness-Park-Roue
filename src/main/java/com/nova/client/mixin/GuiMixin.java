package com.nova.client.mixin;

import com.nova.client.NovaClient;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Gui;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.awt.Color;
import java.util.Comparator;
import java.util.List;

/** Rend le HUD NovaClient (watermark + ArrayList) après le rendu vanilla. */
@Mixin(Gui.class)
public class GuiMixin {
    private static float hue;

    @Inject(method = "render", at = @At("TAIL"))
    private void novaclient$renderHud(GuiGraphicsExtractor g, DeltaTracker delta, CallbackInfo ci) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null) return;

        hue = (hue + delta.getRealtimeDeltaTicks() * 0.002f) % 1f;
        int rgb = Color.HSBtoRGB(hue, 0.75f, 1f);

        // Watermark animé
        g.text(mc.font, "§lNovaClient", 4, 4, rgb);

        // ArrayList des modules actifs
        List<Module> active = NovaClient.modules().getModules().stream()
                .filter(Module::isEnabled)
                .sorted(Comparator.comparingInt((Module m) -> mc.font.width(m.getName())).reversed())
                .toList();
        int y = 16;
        int x = mc.getWindow().getGuiScaledWidth();
        for (Module m : active) {
            int w = mc.font.width(m.getName());
            g.fill(x - w - 8, y - 2, x, y + 10, 0x90000000);
            g.fill(x - w - 10, y - 2, x - w - 8, y + 10, colorFor(m.getCategory()));
            g.text(mc.font, m.getName(), x - w - 5, y, rgb);
            y += 12;
        }
    }

    private int colorFor(Category c) {
        return switch (c) {
            case COMBAT -> 0xFFFF5555;
            case MOVEMENT -> 0xFF55FFFF;
            case RENDER -> 0xFFFFFF55;
            case PLAYER -> 0xFF55FF55;
            case WORLD -> 0xFFFFAA00;
            case MISC -> 0xFFAA00FF;
            case EXPLOIT -> 0xFFFF00AA;
        };
    }
}
