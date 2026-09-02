plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "in.bhrakshak.field"
    compileSdk = 34

    defaultConfig {
        applicationId = "in.bhrakshak.field"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
        // 10.0.2.2 = host loopback from the emulator; override for devices
        buildConfigField("String", "API_BASE_URL", "\"http://10.0.2.2:8000\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")

    // lifecycle
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.4")

    // network: Retrofit + OkHttp + kotlinx serialization
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.1")
    implementation("com.jakewharton.retrofit:retrofit2-kotlinx-serialization-converter:1.0.0")

    // offline queue: Room
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    // annotation processor via kapt is avoided; use room-compiler with ksp below if enabled
    // ksp("androidx.room:room-compiler:2.6.1")

    // background sync
    implementation("androidx.work:work-runtime-ktx:2.9.1")

    // secure token storage
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // location
    implementation("com.google.android.gms:play-services-location:21.3.0")

    // free map, no API key
    implementation("org.maplibre.gl:android-sdk:11.0.0")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
