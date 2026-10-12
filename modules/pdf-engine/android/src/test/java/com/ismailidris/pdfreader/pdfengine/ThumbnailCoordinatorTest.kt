package com.ismailidris.pdfreader.pdfengine

import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

class ThumbnailCoordinatorTest {
  /** Fake stages: render blocks on a per-key gate so tests control timing. */
  private class FakeStages : ThumbnailStages<String> {
    val gates = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    val started: MutableList<String> = Collections.synchronizedList(ArrayList())
    val released: MutableList<String> = Collections.synchronizedList(ArrayList())
    val written: MutableList<String> = Collections.synchronizedList(ArrayList())
    val cache = ConcurrentHashMap<String, ThumbnailResult>()
    val failRender: MutableSet<String> = Collections.synchronizedSet(HashSet())
    val failWrite: MutableSet<String> = Collections.synchronizedSet(HashSet())

    fun gate(key: String): CompletableDeferred<Unit> = gates.getOrPut(key) { CompletableDeferred() }

    fun open(vararg keys: String) = keys.forEach { gate(it).complete(Unit) }

    override fun cached(job: ThumbnailJob): ThumbnailResult? = cache[job.key]

    override suspend fun render(job: ThumbnailJob): String {
      started.add(job.key)
      gate(job.key).await()
      if (job.key in failRender) throw IOException("PDFIUM_ERROR:3")
      return "img:${job.key}"
    }

    override fun write(rendered: String, job: ThumbnailJob): ThumbnailResult {
      if (job.key in failWrite) throw IOException("disk")
      written.add(job.key)
      return resultFor(job.key)
    }

    override fun release(rendered: String) {
      released.add(rendered)
    }

    override fun mapFailure(error: Throwable): CodedException =
      if (PdfiumErrors.parseCode(error.message) == PdfiumErrors.FPDF_ERR_FORMAT) {
        PdfEngineException(ErrorCode.CORRUPT_FILE, "corrupt")
      } else {
        CodedException(ERR_THUMBNAIL_FAILED, "failed", null)
      }
  }

  /** Records every settlement per waiter so "exactly once" can be asserted. */
  private class RecordingSettler : ThumbnailSettler<String> {
    val settlements = ConcurrentHashMap<String, MutableList<String>>()

    private fun record(waiter: String, value: String) {
      settlements.computeIfAbsent(waiter) { Collections.synchronizedList(ArrayList()) }.add(value)
    }

    override fun resolve(waiter: String, result: ThumbnailResult) = record(waiter, "ok:${result.file.name}")

    override fun reject(waiter: String, error: CodedException) = record(waiter, "err:${error.code}")

    fun of(waiter: String): List<String> = settlements[waiter]?.toList() ?: emptyList()
  }

  private lateinit var executor: ExecutorCoroutineDispatcher
  private lateinit var scope: CoroutineScope
  private lateinit var stages: FakeStages
  private lateinit var settler: RecordingSettler
  private val writes = AtomicInteger(0)

  @Before
  fun setUp() {
    executor = Executors.newFixedThreadPool(4).asCoroutineDispatcher()
    scope = CoroutineScope(SupervisorJob() + executor)
    stages = FakeStages()
    settler = RecordingSettler()
  }

  @After
  fun tearDown() {
    stages.gates.values.forEach { it.complete(Unit) }
    scope.cancel()
    executor.close()
  }

  private fun coordinator(maxInFlight: Int = 1) =
    ThumbnailCoordinator(scope, executor, stages, settler, maxInFlight) { writes.incrementAndGet() }

  private fun job(key: String) = ThumbnailJob(key, "/docs/$key.pdf", 120)

  private fun awaitUntil(message: String, condition: () -> Boolean) {
    val deadline = System.currentTimeMillis() + 5_000
    while (!condition()) {
      if (System.currentTimeMillis() > deadline) throw AssertionError("Timed out waiting for: $message")
      Thread.sleep(2)
    }
  }

  private fun awaitSettled(vararg waiters: String) =
    awaitUntil("settled ${waiters.toList()}") { waiters.all { settler.of(it).isNotEmpty() } }

  /** Gives stray coroutines a chance to (wrongly) settle twice before asserting. */
  private fun settleQuietPeriod() = Thread.sleep(50)

  @Test
  fun rendersNewestQueuedJobFirst() {
    val c = coordinator(maxInFlight = 1)
    c.submit("ra", job("a"), "wa")
    awaitUntil("a started") { stages.started.contains("a") }
    c.submit("rb", job("b"), "wb")
    c.submit("rc", job("c"), "wc")
    c.submit("rd", job("d"), "wd")
    stages.open("b", "c", "d")
    stages.open("a")
    awaitSettled("wa", "wb", "wc", "wd")
    assertEquals(listOf("a", "d", "c", "b"), stages.started.toList())
  }

  @Test
  fun resolvesWithTheWrittenResultAndReleasesTheImage() {
    val c = coordinator()
    stages.open("a")
    c.submit("r1", job("a"), "w1")
    awaitSettled("w1")
    settleQuietPeriod()
    assertEquals(listOf("ok:a.webp"), settler.of("w1"))
    assertEquals(listOf("img:a"), stages.released.toList())
    assertEquals(1, writes.get())
  }

  @Test
  fun cancelWhileRunningIsANoOpAndTheRequestResolvesOnce() {
    val c = coordinator()
    c.submit("r1", job("a"), "w1")
    awaitUntil("a started") { stages.started.contains("a") }
    c.cancel("r1")
    stages.open("a")
    awaitSettled("w1")
    settleQuietPeriod()
    assertEquals(listOf("ok:a.webp"), settler.of("w1"))
  }

  @Test
  fun cancelWhileQueuedRejectsOnceAndNeverRenders() {
    val c = coordinator(maxInFlight = 1)
    c.submit("r1", job("a"), "w1")
    awaitUntil("a started") { stages.started.contains("a") }
    c.submit("r2", job("b"), "w2")
    c.cancel("r2")
    c.cancel("r2")
    assertEquals(listOf("err:CANCELLED"), settler.of("w2"))
    stages.open("a", "b")
    awaitSettled("w1")
    settleQuietPeriod()
    assertEquals(listOf("a"), stages.started.toList())
    assertEquals(listOf("err:CANCELLED"), settler.of("w2"))
  }

  @Test
  fun joinedWaitersShareOneRender() {
    val c = coordinator(maxInFlight = 1)
    c.submit("r1", job("a"), "a1")
    awaitUntil("a started") { stages.started.contains("a") }
    // Joins the running job.
    c.submit("r2", job("a"), "a2")
    // Two requests for a queued job.
    c.submit("r3", job("b"), "b1")
    c.submit("r4", job("b"), "b2")
    stages.open("a", "b")
    awaitSettled("a1", "a2", "b1", "b2")
    settleQuietPeriod()
    assertEquals(listOf("a", "b"), stages.started.toList())
    for (waiter in listOf("a1", "a2")) assertEquals(listOf("ok:a.webp"), settler.of(waiter))
    for (waiter in listOf("b1", "b2")) assertEquals(listOf("ok:b.webp"), settler.of(waiter))
  }

  @Test
  fun aFailureRejectsEveryJoinedWaiterOnceWithTheMappedCode() {
    val c = coordinator()
    stages.failRender.add("bad")
    c.submit("r1", job("bad"), "w1")
    c.submit("r2", job("bad"), "w2")
    stages.open("bad")
    awaitSettled("w1", "w2")
    settleQuietPeriod()
    assertEquals(listOf("err:CORRUPT_FILE"), settler.of("w1"))
    assertEquals(listOf("err:CORRUPT_FILE"), settler.of("w2"))
    assertTrue(stages.released.isEmpty())
    assertEquals(0, writes.get())
  }

  @Test
  fun aWriteFailureStillReleasesTheImage() {
    val c = coordinator()
    stages.failWrite.add("a")
    stages.open("a")
    c.submit("r1", job("a"), "w1")
    awaitSettled("w1")
    assertEquals(listOf("err:$ERR_THUMBNAIL_FAILED"), settler.of("w1"))
    assertEquals(listOf("img:a"), stages.released.toList())
  }

  @Test
  fun aCacheHitInsideTheQueueSkipsRendering() {
    val c = coordinator()
    stages.cache["a"] = resultFor("a")
    c.submit("r1", job("a"), "w1")
    awaitSettled("w1")
    assertEquals(listOf("ok:a.webp"), settler.of("w1"))
    assertTrue(stages.started.isEmpty())
    assertEquals(0, writes.get())
  }

  @Test
  fun destroyRejectsRunningAndQueuedRequestsExactlyOnce() {
    val c = coordinator(maxInFlight = 1)
    c.submit("r1", job("a"), "running")
    awaitUntil("a started") { stages.started.contains("a") }
    c.submit("r2", job("b"), "queued")
    c.destroy()
    assertEquals(listOf("err:CANCELLED"), settler.of("running"))
    assertEquals(listOf("err:CANCELLED"), settler.of("queued"))
    // The running render finishes later; it must not settle again.
    stages.open("a", "b")
    settleQuietPeriod()
    assertEquals(listOf("err:CANCELLED"), settler.of("running"))
    assertEquals(listOf("err:CANCELLED"), settler.of("queued"))
    c.submit("r3", job("c"), "late")
    assertEquals(listOf("err:CANCELLED"), settler.of("late"))
  }

  @Test
  fun scopeCancellationAfterDestroyLeavesNothingUnsettled() {
    val c = coordinator(maxInFlight = 1)
    c.submit("r1", job("a"), "w1")
    awaitUntil("a started") { stages.started.contains("a") }
    c.submit("r2", job("b"), "w2")
    c.destroy()
    scope.cancel()
    settleQuietPeriod()
    assertEquals(listOf("err:CANCELLED"), settler.of("w1"))
    assertEquals(listOf("err:CANCELLED"), settler.of("w2"))
  }

  @Test
  fun duplicateRequestIdIsRejected() {
    val c = coordinator()
    c.submit("r1", job("a"), "w1")
    c.submit("r1", job("b"), "w2")
    assertEquals(listOf("err:$ERR_THUMBNAIL_FAILED"), settler.of("w2"))
    stages.open("a")
    awaitSettled("w1")
    assertEquals(listOf("ok:a.webp"), settler.of("w1"))
  }

  @Test
  fun cancelBeforeSubmitRejectsTheLaterSubmit() {
    val c = coordinator()
    c.cancel("r1")
    c.submit("r1", job("a"), "w1")
    assertEquals(listOf("err:CANCELLED"), settler.of("w1"))
    settleQuietPeriod()
    assertTrue(stages.started.isEmpty())
  }

  @Test
  fun atMostMaxInFlightJobsRunAtOnce() {
    val c = coordinator(maxInFlight = 2)
    for (key in listOf("a", "b", "c", "d", "e")) c.submit("r$key", job(key), "w$key")
    awaitUntil("two started") { stages.started.size == 2 }
    settleQuietPeriod()
    assertEquals(2, stages.started.size)
    stages.open("a", "b", "c", "d", "e")
    awaitSettled("wa", "wb", "wc", "wd", "we")
    assertEquals(5, stages.started.size)
    assertEquals(5, writes.get())
  }

  private companion object {
    fun resultFor(key: String) = ThumbnailResult(File("/cache/thumbs/$key.webp"), 120, 170)
  }
}
