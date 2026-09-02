package com.bhrakshak.field.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow
import java.util.UUID

/**
 * Offline queue — the Android twin of the PWA's Dexie table.
 *
 * Every queued report carries a client-generated UUID; the backend's
 * /reports/sync is idempotent by that UUID AND dedupes by 50 m / 1 h
 * proximity, so retrying after a flaky sync can never create duplicates.
 * Photos taken in-app are pre-screened by Model V (/reports/analyze-photo)
 * when the network allows; the sha1 media key rides on the queued row and
 * is sent as the report's media_ref, which is how the server attaches the
 * verdict to the synced report.
 */
@Entity(tableName = "report_queue")
data class QueuedReport(
    @PrimaryKey val clientId: String = UUID.randomUUID().toString(),
    val category: String,
    val lat: Double,
    val lon: Double,
    val description: String?,
    val takenAt: String,
    val photoPath: String? = null,
    val aiVerdict: String? = null,      // POSITIVE | POSSIBLE | NEGATIVE
    val aiProbability: Double? = null,
    val mediaKey: String? = null,       // sha1:<hex> for /analyze-photo attachment
    val status: String = "pending",     // pending | synced
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "checkins")
data class SafeCheckin(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val lat: Double?,
    val lon: Double?,
    val ts: String,
)

@Dao
interface ReportQueueDao {
    @Query("SELECT COUNT(*) FROM report_queue WHERE status = 'pending'")
    fun pendingCount(): Flow<Int>

    @Insert
    suspend fun enqueue(report: QueuedReport)

    @Query("SELECT * FROM report_queue WHERE status = 'pending'")
    suspend fun pendingOnce(): List<QueuedReport>

    @Query("UPDATE report_queue SET aiVerdict = :verdict, aiProbability = :prob, mediaKey = :mediaKey WHERE clientId = :id")
    suspend fun attachVerdict(id: String, verdict: String, prob: Double, mediaKey: String?)

    @Query("UPDATE report_queue SET status = 'synced' WHERE clientId IN (:ids)")
    suspend fun markSynced(ids: List<String>)

    @Query("DELETE FROM report_queue WHERE status = 'synced' AND createdAt < :before")
    suspend fun prune(before: Long)
}

@Dao
interface CheckinDao {
    @Query("SELECT COUNT(*) FROM checkins")
    fun count(): Flow<Int>

    @Insert
    suspend fun add(checkin: SafeCheckin)

    @Query("SELECT * FROM checkins ORDER BY ts DESC LIMIT 1")
    suspend fun latest(): SafeCheckin?
}

@Database(entities = [QueuedReport::class, SafeCheckin::class], version = 2, exportSchema = false)
abstract class BhuDb : RoomDatabase() {
    abstract fun queueDao(): ReportQueueDao
    abstract fun checkinDao(): CheckinDao

    companion object {
        @Volatile private var instance: BhuDb? = null

        fun get(ctx: android.content.Context): BhuDb =
            instance ?: synchronized(this) {
                instance ?: androidx.room.Room.databaseBuilder(
                    ctx.applicationContext, BhuDb::class.java, "bhrakshak.db"
                ).fallbackToDestructiveMigration().build().also { instance = it }
            }
    }
}
