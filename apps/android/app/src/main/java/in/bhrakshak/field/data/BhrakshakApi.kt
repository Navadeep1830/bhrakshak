package in.bhrakshak.field.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinxserialization.asConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Query
import java.util.concurrent.TimeUnit

/** Base URL of the shared FastAPI backend. Same server as dashboard + PWA. */
object ApiConfig {
    // emulator loopback; override per build for physical devices
    const val BASE_URL: String = BuildConfig.API_BASE_URL
}

// ---------------------------------------------------------------------------
// DTOs — mirror apps/api/app/schemas/schemas.py exactly
// ---------------------------------------------------------------------------
@Serializable
data class LoginIn(val email: String, val password: String)

@Serializable
data class TokenOut(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("token_type") val tokenType: String = "bearer"
)

@Serializable
data class ZoneOut(
    val id: String,
    @SerialName("zone_code") val zoneCode: String,
    val name: String?,
    val district: String?,
    val state: String? = null,
    @SerialName("susc_mean") val suscMean: Double? = null,
    @SerialName("susc_p90") val suscP90: Double? = null,
    val population: Int? = null,
    @SerialName("road_km") val roadKm: Double? = null,
    @SerialName("hazard_level") val hazardLevel: Int = 0,
    @SerialName("prob_24h") val prob24h: Double? = null,
)

@Serializable
data class ReportItem(
    @SerialName("client_id") val clientId: String,
    val category: String,
    val lat: Double?,
    val lon: Double?,
    val description: String? = null,
    @SerialName("taken_at") val takenAt: String? = null,
    @SerialName("media_refs") val mediaRefs: List<String> = emptyList(),
    @SerialName("exif_geo_ok") val exifGeoOk: Boolean? = null,
)

@Serializable
data class SyncBatchIn(
    @SerialName("batch_id") val batchId: String,
    val reports: List<ReportItem>,
)

@Serializable
data class SyncBatchOut(
    @SerialName("batch_id") val batchId: String,
    val accepted: Int,
    @SerialName("duplicates_merged") val duplicatesMerged: Int,
    val flagged: Int,
    @SerialName("synced_ids") val syncedIds: List<String>,
)

@Serializable
data class SafeRouteOut(
    val destination: Destination,
    @SerialName("safety_score") val safetyScore: Double,
    val route: RouteGeometry,
    @SerialName("route_length_km") val routeLengthKm: Double,
    @SerialName("eta_minutes") val etaMinutes: Int,
    @SerialName("mean_hazard_along_route") val meanHazard: Double,
    val alternatives: List<AlternativeShelter> = emptyList(),
)

@Serializable
data class Destination(
    val id: String, val name: String, val district: String?,
    val lat: Double, val lon: Double,
    val capacity: Int? = null, val occupancy: Int? = null,
    @SerialName("has_medical") val hasMedical: Boolean? = null,
)

@Serializable
data class RouteGeometry(val type: String, val coordinates: List<List<Double>>)

@Serializable
data class AlternativeShelter(val shelter_id: String, val safety: Double, @SerialName("distance_km") val distanceKm: Double)

@Serializable
data class WeatherOut(
    @SerialName("zone_code") val zoneCode: String,
    @SerialName("has_data") val hasData: Boolean,
    val current: CurrentWeather? = null,
    @SerialName("id_threshold_check") val idCheck: IdCheck? = null,
)

@Serializable
data class CurrentWeather(
    val ts: String,
    @SerialName("rain_1h_mm") val rain1h: Double?,
    @SerialName("rain_24h_mm") val rain24h: Double?,
    @SerialName("rain_72h_mm") val rain72h: Double?,
    @SerialName("eff_rain_mm") val effRain: Double?,
    @SerialName("soil_moisture_pct") val soilMoisture: Double?,
    val trend: String?,
)

@Serializable
data class IdCheck(
    @SerialName("breach_1h") val breach1h: Boolean,
    @SerialName("breach_24h") val breach24h: Boolean,
    @SerialName("any_breach") val anyBreach: Boolean,
)

// ---------------------------------------------------------------------------
// Retrofit API
// ---------------------------------------------------------------------------
interface BhrakshakApi {
    @POST("api/v1/auth/login")
    suspend fun login(@Body body: LoginIn): TokenOut

    @GET("api/v1/zones")
    suspend fun zones(
        @Query("bbox") bbox: String? = null,
        @Query("district") district: String? = null,
        @Header("Authorization") token: String? = null,
    ): List<ZoneOut>

    @POST("api/v1/reports/sync")
    suspend fun syncReports(
        @Body batch: SyncBatchIn,
        @Header("Authorization") token: String,
    ): SyncBatchOut

    @GET("api/v1/evacuation/safe-route")
    suspend fun safeRoute(
        @Query("lat") lat: Double,
        @Query("lon") lon: Double,
        @Query("population") population: Int? = null,
    ): SafeRouteOut

    @GET("api/v1/zones/{zoneId}/weather")
    suspend fun zoneWeather(@retrofit2.http.Path("zoneId") zoneId: String): WeatherOut
}

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------
object Api {
    val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        .build()

    val service: BhrakshakApi by lazy {
        Retrofit.Builder()
            .baseUrl(if (ApiConfig.BASE_URL.endsWith("/")) ApiConfig.BASE_URL else ApiConfig.BASE_URL + "/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()
            .create(BhrakshakApi::class.java)
    }
}
