package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;

/**
 * CameraClip : la caméra 3e personne traverse les blocs.
 * NOTE : nécessite un mixin sur Camera.getMaxZoom dont la signature 26.2
 * n'est pas confirmée ; ce module expose le réglage en attendant.
 */
public class CameraClip extends Module {
    private static CameraClip instance;

    public CameraClip() { super("CameraClip", "Caméra 3e personne traverse les blocs", Category.RENDER); instance = this; }

    public static boolean isActive() { return instance != null && instance.isEnabled(); }
}
