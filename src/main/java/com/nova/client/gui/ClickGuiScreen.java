package com.nova.client.gui;

import com.nova.client.NovaClient;
import com.nova.client.module.Category;
import com.nova.client.module.Module;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;

/**
 * ClickGUI de NovaClient.
 * Construite exclusivement avec des widgets Button vanilla : aucun override
 * de render() (signature instable en 26.x), donc compatible par design.
 * Une colonne par catégorie, un bouton par module : clic = toggle.
 */
public class ClickGuiScreen extends Screen {
    private static final int COL_WIDTH = 112;
    private static final int BTN_HEIGHT = 20;
    private static final int MARGIN = 8;
    private static final int TOP = 30;

    public ClickGuiScreen() {
        super(Component.translatable("novaclient.gui.title"));
    }

    @Override
    protected void init() {
        int col = 0;
        for (Category cat : Category.values()) {
            int x = MARGIN + col * (COL_WIDTH + MARGIN);
            int y = TOP;
            for (Module m : NovaClient.modules().getByCategory(cat)) {
                Button btn = Button.builder(label(m), b -> {
                            m.toggle();
                            b.setMessage(label(m)); // met à jour la couleur d'état
                        })
                        .bounds(x, y, COL_WIDTH, BTN_HEIGHT)
                        .build();
                addRenderableWidget(btn);
                y += BTN_HEIGHT + 2;
            }
            col++;
        }
    }

    /** Libellé coloré : vert = actif, rouge = inactif. */
    private static Component label(Module m) {
        return Component.literal((m.isEnabled() ? "§a" : "§c") + m.getName());
    }

    @Override
    public void onClose() {
        HudRenderer.onGuiClosed(); // libère la référence pour permettre la réouverture
        super.onClose();
    }

    @Override
    public boolean isPauseScreen() {
        return false; // ne met pas le jeu en pause en solo
    }
}
