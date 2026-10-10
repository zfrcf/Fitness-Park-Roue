package com.nova.client.gui;

import com.nova.client.NovaClient;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.Setting;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;

/**
 * GUI click : liste les modules par catégorie, permet de cliquer pour activer/désactiver,
 * de faire clic-droit pour ouvrir/fermer les settings, et de cliquer sur la ligne
 * "Bind: ..." pour enregistrer une nouvelle touche.
 */
public class ClickGuiScreen extends Screen {
    private static final int CAT_W = 110;
    private static final int MOD_H = 14;
    private static final int C_SET = 0xFFBBBBBB;

    private int catX0;
    private int catY0;
    private Module bound = null;
    private final List<Integer> expanded = new ArrayList<>();

    public ClickGuiScreen() {
        super(Component.literal("NovaClient"));
    }

    @Override
    protected void init() {
        catX0 = 8;
        catY0 = 8;
    }

    @Override
    public void onClose() {
        NovaClient.config().save();
        super.onClose();
    }

    @Override
    public void extractRenderState(GuiGraphicsExtractor g, int mouseX, int mouseY, float delta) {
        super.extractRenderState(g, mouseX, mouseY, delta);
        if (g == null) return;
        int x = catX0;
        for (Category cat : Category.values()) {
            renderCategory(g, cat, x, mouseX, mouseY);
            x += CAT_W + 4;
        }
        if (bound != null) {
            g.text(this.font, "Appuyez sur une touche pour " + bound.getName() + " (Échap = annuler)",
                    10, this.height - 20, 0xFFFFFF55, false);
        }
    }

    private void renderCategory(GuiGraphicsExtractor g, Category cat, int x, int mx, int my) {
        List<Module> mods = NovaClient.modules().getByCategory(cat);
        int y = catY0;
        g.fill(x, y, x + CAT_W, y + MOD_H + 4, 0xFF202020);
        g.text(this.font, cat.getDisplay(), x + 4, y + 4, 0xFFFFFFFF, false);
        y += MOD_H + 4;
        for (Module m : mods) {
            if (bound == m) {
                g.fill(x, y, x + CAT_W, y + MOD_H, 0x80555555);
            } else if (m.isEnabled()) {
                g.fill(x, y, x + CAT_W, y + MOD_H, 0x80005500);
            } else {
                g.fill(x, y, x + CAT_W, y + MOD_H, 0x80000000);
            }
            int color = m.isEnabled() ? 0xFF55FF55 : 0xFFDDDDDD;
            g.text(this.font, m.getName(), x + 4, y + 3, color, false);
            y += MOD_H;
            int idx = NovaClient.modules().getModules().indexOf(m);
            if (expanded.contains(idx)) {
                for (Setting<?> s : m.getSettings()) {
                    String label = settingLabel(s);
                    g.text(this.font, label, x + 8, y + 3, C_SET, false);
                    y += MOD_H;
                }
                if (m.getBind().isBound()) {
                    g.text(this.font, "Bind: " + bindLabel(m), x + 8, y + 3, C_SET, false);
                    y += MOD_H;
                }
            }
        }
    }

    private String settingLabel(Setting<?> s) {
        String v = String.valueOf(s.get());
        return s.getName() + ": " + (v.length() > 14 ? v.substring(0, 14) + "…" : v);
    }

    private String bindLabel(Module m) {
        String k = org.lwjgl.glfw.GLFW.glfwGetKeyName(m.getBind().get(), 0);
        if (k == null) {
            return GLFW.glfwGetKeyScancode(m.getBind().get()) >= 0
                    ? "GLFW_KEY_" + m.getBind().get()
                    : "GLFW_KEY_" + m.getBind().get();
        }
        return k;
    }

    @Override
    public boolean mouseClicked(net.minecraft.client.input.MouseButtonEvent e, boolean isDouble) {
        // si un module attend un bind, capture la touche via keyPressed
        if (bound != null) return super.mouseClicked(e, isDouble);
        int mx = (int) e.x();
        int my = (int) e.y();
        int x = catX0;
        for (Category cat : Category.values()) {
            if (hitCategory(cat, mx, my, x, e.button())) return true;
            x += CAT_W + 4;
        }
        return super.mouseClicked(e, isDouble);
    }

    private boolean hitCategory(Category cat, int mx, int my, int x, int button) {
        List<Module> mods = NovaClient.modules().getByCategory(cat);
        int y = catY0 + MOD_H + 4;
        for (Module m : mods) {
            if (mx >= x && mx <= x + CAT_W && my >= y && my <= y + MOD_H) {
                int idx = NovaClient.modules().getModules().indexOf(m);
                if (button == 0) {
                    m.toggle();
                } else if (button == 1) {
                    if (expanded.contains(idx)) expanded.remove(Integer.valueOf(idx));
                    else expanded.add(idx);
                } else if (button == 2) {
                    bound = m;
                }
                return true;
            }
            y += MOD_H;
            int idx = NovaClient.modules().getModules().indexOf(m);
            if (expanded.contains(idx)) {
                y += m.getSettings().size() * MOD_H;
                if (m.getBind().isBound()) y += MOD_H;
            }
        }
        return false;
    }

    @Override
    public boolean keyPressed(net.minecraft.client.input.KeyEvent e) {
        int keyCode = e.key();
        if (bound != null) {
            if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
                bound.getBind().set(-1);
            } else {
                bound.getBind().set(keyCode);
            }
            bound = null;
            return true;
        }
        if (keyCode == GLFW.GLFW_KEY_ESCAPE) {
            this.onClose();
            return true;
        }
        return super.keyPressed(e);
    }
}
