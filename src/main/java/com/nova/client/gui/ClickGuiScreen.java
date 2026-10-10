package com.nova.client.gui;

import com.nova.client.NovaClient;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.BoolSetting;
import com.nova.client.settings.DoubleSetting;
import com.nova.client.settings.IntSetting;
import com.nova.client.settings.KeybindSetting;
import com.nova.client.settings.ModeSetting;
import com.nova.client.settings.Setting;
import com.nova.client.settings.StringSetting;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

import java.util.List;

/**
 * ClickGUI : un panneau par catégorie.
 * - Clic gauche sur un module : toggle.
 * - Clic droit sur un module : déroule ses paramètres en dessous.
 * - Bool : clic = toggle. Int/Double : clic gauche +, clic droit -.
 * - Mode : clic = cycle. Bind : clic puis touche (ÉCHAP = -1).
 */
public class ClickGuiScreen extends Screen {
    private static final int PANEL_W = 110;
    private static final int ROW_H = 14;
    private static final int HEADER_H = 16;
    private static final int C_BG = 0xC0101018;
    private static final int C_HEADER = 0xE04A1B6B;
    private static final int C_ON = 0xFF9D4EDD;
    private static final int C_OFF = 0xFFBBBBBB;
    private static final int C_SET = 0xFF8A8A8A;

    private Module expanded;      // module dont les paramètres sont déroulés
    private Module binding;       // module en attente d'une touche

    public ClickGuiScreen() { super(Component.literal("NovaClient")); }

    @Override
    public boolean isPauseScreen() { return false; }

    @Override
    public void render(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
        g.fill(0, 0, width, height, 0x60000000);
        int x = 8;
        for (Category cat : Category.values()) {
            List<Module> mods = NovaClient.modules().getByCategory(cat);
            if (mods.isEmpty()) continue;
            renderPanel(g, cat, mods, x, 8);
            x += PANEL_W + 6;
        }
        super.render(g, mouseX, mouseY, delta);
    }

    private void renderPanel(GuiGraphicsExtractor g, Category cat, List<Module> mods, int x, int y) {
        g.fill(x, y, x + PANEL_W, y + HEADER_H, C_HEADER);
        g.drawString(font, cat.getDisplay(), x + 4, y + 4, 0xFFFFFFFF, false);
        int ry = y + HEADER_H;
        for (Module m : mods) {
            g.fill(x, ry, x + PANEL_W, ry + ROW_H, C_BG);
            int color = m.isEnabled() ? C_ON : C_OFF;
            String label = (binding == m ? "§e[...] " : "") + m.getName() + (expanded == m ? " §7▼" : "");
            g.drawString(font, label, x + 4, ry + 3, binding == m ? 0xFFFFFF55 : color, false);
            ry += ROW_H;
            if (expanded == m) {
                for (Setting<?> s : m.getSettings()) {
                    if (!s.isVisible()) continue;
                    g.fill(x, ry, x + PANEL_W, ry + ROW_H, 0xC01E1E28);
                    g.drawString(g == null ? null : font, settingLabel(s), x + 8, ry + 3, C_SET, false);
                    ry += ROW_H;
                }
                // Bind en bas des paramètres
                g.fill(x, ry, x + PANEL_W, ry + ROW_H, 0xC01E1E28);
                g.drawString(font, "Bind: " + bindLabel(m), x + 8, ry + 3, C_SET, false);
                ry += ROW_H;
            }
        }
    }

    private String settingLabel(Setting<?> s) {
        if (s instanceof BoolSetting b) return s.getName() + ": " + (b.get() ? "§aON" : "§cOFF");
        if (s instanceof IntSetting i) return s.getName() + ": " + i.get();
        if (s instanceof DoubleSetting d) return s.getName() + ": " + String.format(java.util.Locale.ROOT, "%.2f", d.get());
        if (s instanceof ModeSetting<?> md) return s.getName() + ": " + md.get().name();
        if (s instanceof StringSetting st) return s.getName() + ": " + st.get();
        return s.getName();
    }

    private String bindLabel(Module m) {
        return m.getBind().isBound() ? String.valueOf(m.getBind().get()) : "aucun";
    }

    @Override
    public boolean mouseClicked(double mx, double my, int button) {
        int x = 8;
        for (Category cat : Category.values()) {
            List<Module> mods = NovaClient.modules().getByCategory(cat);
            if (mods.isEmpty()) continue;
            if (handlePanelClick(cat, mods, x, 8, mx, my, button)) return true;
            x += PANEL_W + 6;
        }
        return super.mouseClicked(mx, my, button);
    }

    /** @return true si le clic a été consommé par ce panneau. */
    private boolean handlePanelClick(Category cat, List<Module> mods, int x, int y,
                                     double mx, double my, int button) {
        int ry = y + HEADER_H;
        for (Module m : mods) {
            if (in(mx, my, x, ry, PANEL_W, ROW_H)) {
                if (button == 0) { m.toggle(); NovaClient.config().save(); }
                else if (button == 1) { expanded = expanded == m ? null : m; }
                return true;
            }
            ry += ROW_H;
            if (expanded == m) {
                for (Setting<?> s : m.getSettings()) {
                    if (!s.isVisible()) continue;
                    if (in(mx, my, x, ry, PANEL_W, ROW_H)) { clickSetting(s, button); return true; }
                    ry += ROW_H;
                }
                if (in(mx, my, x, ry, PANEL_W, ROW_H)) {
                    if (button == 0) binding = m; // prochaine touche = bind
                    return true;
                }
                ry += ROW_H;
            }
        }
        return false;
    }

    private void clickSetting(Setting<?> s, int button) {
        if (s instanceof BoolSetting b) b.toggle();
        else if (s instanceof IntSetting i) {
            int step = Math.max(1, (i.getMax() - i.getMin()) / 20);
            i.set(i.get() + (button == 0 ? step : -step));
        } else if (s instanceof DoubleSetting d) {
            double step = Math.max(0.05, (d.getMax() - d.getMin()) / 20.0);
            d.set(d.get() + (button == 0 ? step : -step));
        } else if (s instanceof ModeSetting<?> md) md.cycle();
        // StringSetting : édition via commandes chat uniquement
        NovaClient.config().save();
    }

    @Override
    public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
        if (binding != null) {
            binding.getBind().set(keyCode == GLFW.GLFW_KEY_ESCAPE ? -1 : keyCode);
            binding = null;
            NovaClient.config().save();
            return true;
        }
        return super.keyPressed(keyCode, scanCode, modifiers);
    }

    private boolean in(double mx, double my, int x, int y, int w, int h) {
        return mx >= x && mx < x + w && my >= y && my < y + h;
    }
}
