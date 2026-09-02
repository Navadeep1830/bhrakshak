package in.bhrakshak.field.data

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
 * Photos are stored locally under files/photos/ and referenced by path
 * until sync uploads them (media_refs carry sha1 keys, matching
 * /reports/analyze-photo attachment).
 */
@Entity(tableName = "report_queue")
data class QueuedReport(
    @PrimaryKey val clientId: String = UUID.randomUUID().toString(),
    val category: String,
    val lat: Double?,
    val lon: Double?,
    val description: String?,
    val takenAt: String,
    val photoPath: String? = null,
    val status: String = "pending",  // pending | synced | flagged
    val createdAt: Long = System.currentTimeMillis(),
)

@Dao
interface ReportQueueDao {
    @Query("SELECT * FROM report_queue WHERE status = 'pending' ORDER BY createdAt")
    fun pending(): Flow<List<QueuedReport>>

    @Query("SELECT COUNT(*) FROM report_queue WHERE status = 'pending'")
    fun pendingCount(): Flow<Int>

    @Insert
    suspend fun enqueue(report: QueuedReport)

    @Query("SELECT * FROM report_queue WHERE status = 'pending'")
    suspend fun pendingOnce(): List<QueuedReport>

    @Query("UPDATE report_queue SET status = 'synced' WHERE clientId IN (:ids)")
    suspend fun markSynced(ids: List<String>)

    @Query("DELETE FROM report_queue WHERE status = 'synced' AND createdAt < :before")
    suspend fun prune(before: Long)
}

@Database(entities = [QueuedReport::class], version = 1, exportSchema = false)
abstract class BhuDb : RoomDatabase() {
    abstract fun queueDao(): ReportQueueDao

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
