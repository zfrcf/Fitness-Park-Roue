package com.nova.client.render;

import com.mojang.blaze3d.pipeline.RenderTarget;
import com.mojang.blaze3d.systems.RenderSystem;
import com.mojang.blaze3d.vertex.BufferBuilder;
import com.mojang.blaze3d.vertex.BufferUploader;
import com.mojang.blaze3d.vertex.DefaultVertexFormat;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.Tesselator;
import com.mojang.blaze3d.vertex.VertexFormat;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GameRenderer;
import net.minecraft.core.BlockPos;
import net.minecraft.world.phys.Vec3;
import org.joml.Matrix4f;

import java.util.Collection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Supplier;

/**
 * Moteur de rendu 3D : dessine des boîtes (contours) dans le monde.
 * Les modules enregistrent un fournisseur de positions + une couleur.
 * Rendu via WorldRenderEvents.LAST (compatible Sodium/Iris).
 */
public final class RenderUtil {
    private record Entry(Supplier<Collection<BlockPos>> positions, Supplier<float[]> color) {}

    private static final Map<Object, Entry> ENTRIES = new ConcurrentHashMap<>();
    private static boolean registered;

    private RenderUtil() {}

    public static void register(Object owner, Supplier<Collection<BlockPos>> positions, Supplier<float[]> color) {
        ENTRIES.put(owner, new Entry(positions, color));
        ensureHook();
    }

    public static void unregister(Object owner) {
        ENTRIES.remove(owner);
    }

    private static void ensureHook() {
        if (registered) return;
        registered = true;
        WorldRenderEvents.LAST.register(context -> render(context.matrixStack(), context.camera().getPosition()));
    }

    private static void render(PoseStack pose, Vec3 cam) {
        if (ENTRIES.isEmpty()) return;
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) return;

        RenderSystem.enableBlend();
        RenderSystem.defaultBlendFunc();
        RenderSystem.disableDepthTest();
        RenderSystem.lineWidth(2.0f);
        RenderSystem.setShader(GameRenderer::getPositionColorShader);

        pose.pushPose();
        pose.translate(-cam.x, -cam.y, -cam.z);
        Matrix4f m = pose.last().pose();

        Tesselator tess = Tesselator.getInstance();
        BufferBuilder buf = tess.begin(VertexFormat.Mode.DEBUG_LINES, DefaultVertexFormat.POSITION_COLOR);

        for (Entry e : ENTRIES.values()) {
            Collection<BlockPos> positions;
            float[] c;
            try {
                positions = e.positions().get();
                c = e.color().get();
            } catch (Throwable t) { continue; }
            if (positions == null || positions.isEmpty() || c == null || c.length < 4) continue;
            int r = (int) (c[0] * 255), g = (int) (c[1] * 255), b = (int) (c[2] * 255), a = (int) (c[3] * 255);
            for (BlockPos p : positions) {
                box(buf, m, p.getX(), p.getY(), p.getZ(), p.getX() + 1, p.getY() + 1, p.getZ() + 1, r, g, b, a);
            }
        }

        BufferUploader.drawWithShader(buf.buildOrThrow());
        pose.popPose();

        RenderSystem.enableDepthTest();
        RenderSystem.disableBlend();
    }

    /** Dessine les 12 arêtes d'une boîte. */
    private static void box(BufferBuilder buf, Matrix4f m,
                            double x1, double y1, double z1, double x2, double y2, double z2,
                            int r, int g, int b, int a) {
        // bas
        line(buf, m, x1, y1, z1, x2, y1, z1, r, g, b, a);
        line(buf, m, x2, y1, z1, x2, y1, z2, r, g, b, a);
        line(buf, m, x2, y1, z2, x1, y1, z2, r, g, b, a);
        line(buf, m, x1, y1, z2, x1, y1, z1, r, g, b, a);
        // haut
        line(buf, m, x1, y2, z1, x2, y2, z1, r, g, b, a);
        line(buf, m, x2, y2, z1, x2, y2, z2, r, g, b, a);
        line(buf, m, x2, y2, z2, x1, y2, z2, r, g, b, a);
        line(buf, m, x1, y2, z2, x1, y2, z1, r, g, b, a);
        // verticales
        line(buf, m, x1, y1, z1, x1, y2, z1, r, g, b, a);
        line(buf, m, x2, y1, z1, x2, y2, z1, r, g, b, a);
        line(buf, m, x2, y1, z2, x2, y2, z2, r, g, b, a);
        line(buf, m, x1, y1, z2, x1, y2, z2, r, g, b, a);
    }

    private static void line(BufferBuilder buf, Matrix4f m,
                             double x1, double y1, double z1, double x2, double y2, double z2,
                             int r, int g, int b, int a) {
        buf.addVertex(m, (float) x1, (float) y1, (float) z1).setColor(r, g, b, a);
        buf.addVertex(m, (float) x2, (float) y2, (float) z2).setColor(r, g, b, a);
    }
}
