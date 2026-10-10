package com.nova.client.addon;

/**
 * API publique des addons NovaClient.
 * Un addon est un mod Fabric déclarant un entrypoint "novaclient:addon"
 * implémentant cette interface. Il peut enregistrer modules, commandes
 * et listeners via les accesseurs statiques de NovaClient.
 */
public interface NovaAddon {
    String getName();
    String getVersion();
    /** Appelé après l'initialisation complète de NovaClient. */
    void onInitialize();
}
