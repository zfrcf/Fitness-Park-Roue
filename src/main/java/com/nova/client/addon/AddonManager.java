package com.nova.client.addon;

import com.nova.client.NovaClient;
import net.fabricmc.loader.api.FabricLoader;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Charge les addons via l'entrypoint Fabric "novaclient:addon".
 * Chaque addon est isolé : un crash dans un addon le désactive sans
 * affecter le client ni les autres addons.
 */
public class AddonManager {
    private final List<NovaAddon> addons = new ArrayList<>();
    private final List<String> failed = new ArrayList<>();

    public void loadAddons() {
        for (NovaAddon addon : FabricLoader.getInstance().getEntrypoints("novaclient:addon", NovaAddon.class)) {
            try {
                // Vérification de compatibilité via @AddonInfo
                AddonInfo info = addon.getClass().getAnnotation(AddonInfo.class);
                if (info != null && !isCompatible(info.minNovaVersion())) {
                    failed.add(addon.getName() + " (requiert NovaClient >= " + info.minNovaVersion() + ")");
                    continue;
                }
                addon.onInitialize();
                addons.add(addon);
                NovaClient.LOGGER.info("Addon chargé : {} v{}", addon.getName(), addon.getVersion());
            } catch (Throwable t) {
                // Isolation des crashs : l'addon fautif est ignoré proprement
                failed.add(addon.getName() + " (crash: " + t.getClass().getSimpleName() + ")");
                NovaClient.LOGGER.error("L'addon '{}' a planté et a été désactivé", addon.getName(), t);
            }
        }
    }

    /** Compare "x.y.z" : true si la version du client >= min. */
    private boolean isCompatible(String min) {
        String[] cur = NovaClient.VERSION.split("\\.");
        String[] req = min.split("\\.");
        for (int i = 0; i < Math.min(cur.length, req.length); i++) {
            int c = Integer.parseInt(cur[i]), r = Integer.parseInt(req[i]);
            if (c != r) return c > r;
        }
        // Préfixes égaux : "1.0" ne satisfait pas "1.0.1"
        return cur.length >= req.length;
    }

    public List<NovaAddon> getAddons() { return Collections.unmodifiableList(addons); }
    /** Addons refusés ou plantés, avec la raison. */
    public List<String> getFailed() { return Collections.unmodifiableList(failed); }
}
