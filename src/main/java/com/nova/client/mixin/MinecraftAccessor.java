package com.nova.client.mixin;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

/**
 * Accesseur sur Minecraft : expose setScreen(Screen) par son descripteur.
 * L'@Invoker sans nom explicite cible la méthode unique de signature
 * (Lnet/minecraft/client/gui/screens/Screen;)V — stable quel que soit
 * le nom source en 26.2.
 */
@Mixin(Minecraft.class)
public interface MinecraftAccessor {
    @Invoker("setScreen")
    void novaclient$setScreen(Screen screen);
}
