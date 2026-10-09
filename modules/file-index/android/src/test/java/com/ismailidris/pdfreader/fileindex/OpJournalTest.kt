package com.ismailidris.pdfreader.fileindex

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class OpJournalTest {
  @get:Rule
  val temp = TemporaryFolder()

  @Test
  fun entriesRoundTripIncludingUnusualNames() {
    val base = temp.root.absoluteFile
    val rename = OpJournal.Entry.Rename(File(base, ".rename-1-abc"), File(base, "Rapport été\nfinal.pdf"))
    val copy = OpJournal.Entry.CopyTemp(File(base, ".x.pdf.tmp-1-abc"))
    assertEquals(rename, OpJournal.decode(OpJournal.encode(rename)))
    assertEquals(copy, OpJournal.decode(OpJournal.encode(copy)))
  }

  @Test
  fun malformedEntriesDecodeToNull() {
    assertNull(OpJournal.decode(ByteArray(0)))
    assertNull(OpJournal.decode("rename\u0000/only-one".toByteArray()))
    assertNull(OpJournal.decode("copy\u0000relative/path".toByteArray()))
    assertNull(OpJournal.decode("other\u0000/a".toByteArray()))
  }

  @Test
  fun beginSyncsTheJournalFolderAndEndRemovesTheEntry() {
    val dir = temp.newFolder("journal")
    val synced = ArrayList<File>()
    val journal = OpJournal(dir) { synced.add(it) }
    val id = journal.begin(OpJournal.Entry.CopyTemp(File(temp.root, ".a.tmp-1-x").absoluteFile))
    assertEquals(listOf(dir), synced)
    assertEquals(1, dir.list()!!.size)
    journal.end(id)
    assertEquals(0, dir.list()!!.size)
  }

  @Test
  fun pendingSkipsRunningEntriesAndDropsUnreadableOnes() {
    val dir = temp.newFolder("journal")
    val journal = OpJournal(dir)
    val entry = OpJournal.Entry.CopyTemp(File(temp.root, ".a.tmp-1-x").absoluteFile)
    val running = journal.begin(entry)
    val abandoned = journal.begin(entry)
    journal.abandon(abandoned)
    File(dir, "123-broken.op").writeBytes("garbage".toByteArray())
    try {
      assertEquals(listOf(abandoned to entry), journal.pending())
      // The unreadable entry is gone; the two real ones stay.
      assertEquals(2, dir.list()!!.size)
    } finally {
      journal.end(running)
      journal.end(abandoned)
    }
  }
}
