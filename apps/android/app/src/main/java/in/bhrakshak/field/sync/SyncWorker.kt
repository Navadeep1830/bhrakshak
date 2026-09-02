package in.bhrakshak.field.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import in.bhrakshak.field.data.Api
import in.bhrakshak.field.data.BhuDb
import in.bhrakshak.field.data.ReportItem
import in.bhrakshak.field.data.SyncBatchIn
import in.bhrakshak.field.data.TokenStore
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Flushes the offline report queue to the backend.
 *
 * Scheduled every 15 minutes AND triggered immediately on connectivity
 * (ConnectivityManager callback in MainActivity). Retries forever with
 * backoff — WorkManager guarantees the enqueue survives process death
 * and reboots, which is the whole point for NER valleys with patchy links.
 */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val db = BhuDb.get(applicationContext)
        val dao = db.queueDao()
        val pending = dao.pendingOnce()
        if (pending.isEmpty()) return Result.success()

        val token = TokenStore.access(applicationContext)
            ?: return Result.retry() // not logged in yet; try after login

        return try {
            val out = Api.service.syncReports(
                SyncBatchIn(
                    batchId = UUID.randomUUID().toString(),
                    reports = pending.map { r ->
                        ReportItem(
                            clientId = r.clientId,
                            category = r.category,
                            lat = r.lat,
                            lon = r.lon,
                            description = r.description,
                            takenAt = r.takenAt,
                            mediaRefs = emptyList(), // photo upload lands in Phase 2
                            exifGeoOk = r.lat != null && r.lon != null,
                        )
                    },
                ),
                token = "Bearer $token",
            )
            dao.markSynced(out.syncedIds)
            dao.prune(System.currentTimeMillis() - 7L * 24 * 3600 * 1000)
            Result.success()
        } catch (e: Exception) {
            Result.retry() // offline or 5xx; WorkManager backs off exponentially
        }
    }

    companion object {
        fun schedule(ctx: Context) {
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                "bhrakshak-sync",
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).build(),
            )
        }
    }
}
