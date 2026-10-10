package com.nova.client.module.modules.render;

import com.nova.client.module.Category;
import com.nova.client.module.Module;

/** CameraClip : la caméra 3e personne traverse les blocs (via CameraClipMixin). */
public class CameraClip extends Module {
    private static CameraClip instance;

    public CameraClip() { super("CameraClip", "Caméra 3e personne traverse les blocs"); instance = this; }

    public static boolean isActive() { return instance != null && instance.isEnabled(); }
}
