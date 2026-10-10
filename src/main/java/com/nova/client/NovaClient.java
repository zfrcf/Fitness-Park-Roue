package com.nova.client;

import com.nova.client.addon.AddonManager;
import com.nova.client.command.CommandManager;
import com.nova.client.config.ConfigManager;
import com.nova.client.event.EventBus;
import com.nova.client.friend.FriendManager;
import com.nova.client.module.ModuleManager;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Point d'entrée client. Singleton avec accesseurs statiques. */
public class NovaClient implements ClientModInitializer {
    public static final String MOD_ID = "novaclient";
    public static final String NAME = "NovaClient";
    public static final String VERSION = "1.0.0";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    private static NovaClient instance;
    private EventBus eventBus;
    private ModuleManager moduleManager;
    private ConfigManager configManager;
    private CommandManager commandManager;
    private FriendManager friendManager;
    private AddonManager addonManager;

    @Override
    public void onInitializeClient() {
        instance = this;
        long start = System.currentTimeMillis();

        eventBus = new EventBus();
        moduleManager = new ModuleManager();
        configManager = new ConfigManager(FabricLoader.getInstance().getGameDir().resolve("nova").toFile());
        commandManager = new CommandManager();
        friendManager = new FriendManager(configManager.getDir());
        com.nova.client.waypoint.WaypointManager.init(configManager.getDir());
        addonManager = new AddonManager();

        moduleManager.registerAll();
        addonManager.loadAddons();
        configManager.load();

        final int[] counter = {0};
        ClientTickEvents.END_CLIENT_TICK.register(mc -> {
            if (++counter[0] >= 1200) { counter[0] = 0; configManager.save(); }
        });

        commandManager.register();
        com.nova.client.gui.GuiKeybinds.register();

        Runtime.getRuntime().addShutdownHook(new Thread(configManager::save));
        LOGGER.info("{} {} chargé en {} ms ({} modules, {} addons)",
                NAME, VERSION, System.currentTimeMillis() - start,
                moduleManager.getModules().size(), addonManager.getAddons().size());
    }

    public static NovaClient getInstance() { return instance; }
    public static EventBus events() { return instance.eventBus; }
    public static ModuleManager modules() { return instance.moduleManager; }
    public static ConfigManager config() { return instance.configManager; }
    public static CommandManager commands() { return instance.commandManager; }
    public static FriendManager friends() { return instance.friendManager; }
    public static AddonManager addons() { return instance.addonManager; }
}
