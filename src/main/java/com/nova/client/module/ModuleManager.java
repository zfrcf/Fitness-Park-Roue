package com.nova.client.module;

import com.nova.client.module.modules.combat.Criticals;
import com.nova.client.module.modules.combat.CrystalAura;
import com.nova.client.module.modules.combat.AutoTotem;
import com.nova.client.module.modules.combat.KillAura;
import com.nova.client.module.modules.combat.Surround;
import com.nova.client.module.modules.combat.TriggerBot;
import com.nova.client.module.modules.exploit.AntiHunger;
import com.nova.client.module.modules.misc.ClientSpoof;
import com.nova.client.module.modules.misc.Panic;
import com.nova.client.module.modules.movement.Fly;
import com.nova.client.module.modules.movement.NoFall;
import com.nova.client.module.modules.movement.Sprint;
import com.nova.client.module.modules.movement.Velocity;
import com.nova.client.module.modules.player.AutoRespawn;
import com.nova.client.module.modules.render.Esp;
import com.nova.client.module.modules.render.Fullbright;
import com.nova.client.module.modules.render.Tracers;
import com.nova.client.module.modules.world.TimerModule;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

/** Registre central des modules. register() est public : utilisé aussi par les addons. */
public class ModuleManager {
    private final List<Module> modules = new ArrayList<>();

    public void registerAll() {
        // Combat
        register(new KillAura());
        register(new CrystalAura());
        register(new AutoTotem());
        register(new Surround());
        register(new TriggerBot());
        register(new Criticals());
        // Movement
        register(new Sprint());
        register(new Velocity());
        register(new NoFall());
        register(new Fly());
        // Render
        register(new Fullbright());
        register(new Esp());
        register(new Tracers());
        // Player
        register(new AutoRespawn());
        // World
        register(new TimerModule());
        // Misc
        register(new Panic());
        register(new ClientSpoof());
        // Exploit
        register(new AntiHunger());

        // Init des settings + gestion des binds au tick
        for (Module m : modules) m.registerSettings();
        ClientTickEvents.END_CLIENT_TICK.register(mc -> {
            // Poste le TickEvent pour tous les modules abonnés
            com.nova.client.NovaClient.events().post(new com.nova.client.event.events.TickEvent());
            if (mc.getWindow() == null) return;
            long handle = mc.getWindow().handle();
            for (Module m : modules) m.handleBind(handle);
        });
    }

    /** Enregistrement public (addons compris). */
    public void register(Module m) {
        modules.add(m);
        modules.sort(Comparator.comparing(Module::getName));
    }

    /** Vue non modifiable : un addon ne peut pas altérer le registre par accident. */
    public List<Module> getModules() { return java.util.Collections.unmodifiableList(modules); }

    public List<Module> getByCategory(Category c) {
        return modules.stream().filter(m -> m.getCategory() == c).toList();
    }

    public Module getByName(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        return modules.stream().filter(m -> m.getName().toLowerCase(Locale.ROOT).equals(n)).findFirst().orElse(null);
    }

    public void disableAll() {
        for (Module m : new ArrayList<>(modules)) if (m.isEnabled()) m.setEnabled(false);
    }
}
