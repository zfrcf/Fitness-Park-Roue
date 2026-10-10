package com.nova.client.addon;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/** Métadonnées d'un addon, lues par l'AddonManager pour la compatibilité. */
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface AddonInfo {
    String name();
    String version();
    String author() default "Inconnu";
    /** Version minimale de NovaClient requise (ex. "1.0.0"). */
    String minNovaVersion() default "1.0.0";
}
