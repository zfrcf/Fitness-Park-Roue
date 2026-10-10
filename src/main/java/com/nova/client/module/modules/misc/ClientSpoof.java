package com.nova.client.module.modules.misc;

import com.nova.client.module.Category;
import com.nova.client.module.Module;
import com.nova.client.settings.StringSetting;

/**
 * VanillaSpoofer : le serveur voit le brand "vanilla" (mixin ClientBrandRetriever).
 * Activé par défaut. Le brand custom n'est visible qu'en F3 local.
 */
public class ClientSpoof extends Module {
    private static ClientSpoof instance;

    private final StringSetting brand = addSetting(new StringSetting("Brand", "Brand F3 local", "NovaClient"));

    public ClientSpoof() {
        super("ClientSpoof", "Spoofer vanilla (brand serveur = vanilla)", Category.MISC);
        instance = this;
    }

    /** true si le spoof est actif (défaut : activé même si le module est off). */
    public static boolean isSpoofing() {
        return instance == null || instance.isEnabled() || true; // toujours actif par sécurité
    }

    @Override
    protected void onEnable() { }

    static { /* activé par défaut */ }
}
