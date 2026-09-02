# Retrofit uses generic signatures; keep kotlinx-serialization DTOs
-keepattributes Signature, InnerClasses, EnclosingMethod
-keep class com.bhrakshak.field.data.** { *; }
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
