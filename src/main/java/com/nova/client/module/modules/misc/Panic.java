package com.nova.client.module.modules.misc;

import com.nova.client.NovaClient;
import com.nova.client.module.Category;
import com.nova.client.module.Module;

/** Panic : désactive instantanément tous les modules, puis se désactive. */
public class Panic extends Module {
    public Panic() { super("Panic", "Désactive tous les modules", Category.MISC); }

    @Override
    protected void onEnable() {
        NovaClient.modules().disableAll(); // désactive aussi Panic lui-même
    }
}
