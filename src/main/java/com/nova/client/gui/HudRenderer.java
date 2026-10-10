package com.nova.client.gui;

import com.nova.client.NovaClient;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import java.util.ArrayList;
import java.util.List;

/**
 * HUD simple : liste les modules actifs en haut à gauche et affiche la version
 * du client en bas à gauche. Rendu déclenché par GuiMixin après le HUD vanilla.
 */
public final class HudRenderer {
    private static final int[] COLOR = {0xFFAAAAAA};

    private HudRenderer() {}

    /** Appelé par GuiMixin (mixin de Gui.extractRenderState). */
    public static void render(GuiGraphicsExtractor g, int screenWidth, int screenHeight) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.gui != null && mc.gui.hud != null && mc.gui.hud.isHidden()) return;

        List<String> lines = new ArrayList<>();
        int active = 0;
        for (Category c : Category.values()) {
            List<Module> mods = NovaClient.modules().getByCategory(c);
            List<String> enabled = new ArrayList<>();
            for (Module m : mods) {
                if (m.isEnabled()) enabled.add(m.getName());
            }
            if (!enabled.isEmpty()) {
                active += enabled.size();
                lines.add(c.getDisplay() + ": " + String.join(", ", enabled));
            }
        }
        if (active > 0) {
            lines.add(0, "NovaClient v" + NovaClient.VERSION + " (" + active + " actifs)");
        } else {
            lines.add(0, "NovaClient v" + NovaClient.VERSION);
        }

        int y = 4;
        for (String s : lines) {
            g.text(mc.font, s, 4, y, COLOR[0], false);
            y += mc.font.lineHeight + 1;
        }
    }
}
