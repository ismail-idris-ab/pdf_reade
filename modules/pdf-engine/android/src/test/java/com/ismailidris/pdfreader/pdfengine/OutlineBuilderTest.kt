package com.ismailidris.pdfreader.pdfengine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OutlineBuilderTest {
  /** In-memory bookmark graph; links may form cycles, like malformed files. */
  private class FakeOutline : OutlineSource {
    val firstChildren = HashMap<Long, Long>()
    val siblings = HashMap<Long, Long>()
    val titles = HashMap<Long, String>()
    val pages = HashMap<Long, Int?>()
    var calls = 0

    fun item(id: Long, title: String, page: Int?) {
      titles[id] = title
      pages[id] = page
    }

    /** Links [children] in order under [parent] (0 = root). */
    fun children(parent: Long, vararg children: Long) {
      firstChildren[parent] = children.first()
      children.toList().zipWithNext().forEach { (a, b) -> siblings[a] = b }
    }

    override fun firstChild(parent: Long): Long {
      calls++
      return firstChildren[parent] ?: 0L
    }

    override fun nextSibling(item: Long): Long {
      calls++
      return siblings[item] ?: 0L
    }

    override fun title(item: Long): String = titles.getValue(item)

    override fun page(item: Long): Int? = pages[item]
  }

  @Test
  fun emptyOutlineIsAnEmptyList() {
    assertEquals(emptyList<OutlineNode>(), OutlineBuilder.build(FakeOutline()))
  }

  @Test
  fun buildsANestedTreeInOrderWithNullPages() {
    val outline = FakeOutline().apply {
      item(1, "Chapter 1", 0)
      item(2, "Section 1.1", 1)
      item(3, "Section 1.2", null)
      item(4, "Chapter 2", 5)
      item(5, "Deep", 6)
      children(0, 1, 4)
      children(1, 2, 3)
      children(3, 5)
    }
    val expected = listOf(
      OutlineNode(
        "Chapter 1",
        0,
        listOf(
          OutlineNode("Section 1.1", 1, emptyList()),
          OutlineNode("Section 1.2", null, listOf(OutlineNode("Deep", 6, emptyList()))),
        ),
      ),
      OutlineNode("Chapter 2", 5, emptyList()),
    )
    assertEquals(expected, OutlineBuilder.build(outline))
  }

  @Test
  fun siblingCycleStopsAtTheFirstRevisit() {
    val outline = FakeOutline().apply {
      item(1, "A", 0)
      item(2, "B", 1)
      children(0, 1, 2)
      siblings[2] = 1
    }
    assertEquals(listOf("A", "B"), OutlineBuilder.build(outline).map { it.title })
  }

  @Test
  fun childPointingBackAtItsAncestorIsNotRepeated() {
    val outline = FakeOutline().apply {
      item(1, "Parent", 0)
      item(2, "Child", 1)
      children(0, 1)
      children(1, 2)
      firstChildren[2] = 1
    }
    val tree = OutlineBuilder.build(outline)
    assertEquals(1, tree.size)
    assertEquals(listOf(OutlineNode("Child", 1, emptyList())), tree[0].children)
  }

  @Test
  fun selfLinkedItemAppearsOnce() {
    val outline = FakeOutline().apply {
      item(1, "Loop", 0)
      children(0, 1)
      siblings[1] = 1
      firstChildren[1] = 1
    }
    assertEquals(listOf(OutlineNode("Loop", 0, emptyList())), OutlineBuilder.build(outline))
  }

  private fun chain(length: Long): FakeOutline {
    val outline = FakeOutline()
    for (id in 1L..length) {
      outline.item(id, "Level $id", null)
      outline.children(id - 1, id)
    }
    return outline
  }

  private fun depthOf(tree: List<OutlineNode>): Int {
    var depth = 0
    var level = tree
    while (level.isNotEmpty()) {
      depth++
      assertEquals(1, level.size)
      level = level[0].children
    }
    return depth
  }

  @Test
  fun depthIsCapped() {
    assertEquals(5, depthOf(OutlineBuilder.build(chain(100), maxDepth = 5)))
  }

  @Test
  fun defaultDepthCapIs32() {
    assertEquals(OutlineBuilder.MAX_DEPTH, depthOf(OutlineBuilder.build(chain(100))))
    assertEquals(32, OutlineBuilder.MAX_DEPTH)
  }

  @Test
  fun itemCountIsCappedAndTheWalkStops() {
    val outline = FakeOutline()
    val ids = (1L..50_000L).toList()
    ids.forEach { outline.item(it, "Item $it", null) }
    outline.children(0, *ids.toLongArray())
    val tree = OutlineBuilder.build(outline, maxItems = 1_000)
    assertEquals(1_000, tree.size)
    assertTrue("walk kept going: ${outline.calls}", outline.calls < 2_200)
    assertEquals(OutlineBuilder.MAX_ITEMS, OutlineBuilder.build(outline).size)
    assertEquals(10_000, OutlineBuilder.MAX_ITEMS)
  }

  @Test
  fun itemCapCountsNestedItems() {
    val outline = FakeOutline().apply {
      item(1, "A", 0)
      item(2, "A.1", 1)
      item(3, "A.2", 2)
      item(4, "B", 3)
      children(0, 1, 4)
      children(1, 2, 3)
    }
    val tree = OutlineBuilder.build(outline, maxItems = 3)
    assertEquals(listOf("A"), tree.map { it.title })
    assertEquals(listOf("A.1", "A.2"), tree[0].children.map { it.title })
  }

  @Test
  fun titlesAreTrimmedAndCappedWithoutSplittingSurrogates() {
    assertEquals("Intro", OutlineBuilder.trimTitle("  Intro \n"))
    val long = "x".repeat(OutlineBuilder.MAX_TITLE_LENGTH + 50)
    assertEquals(OutlineBuilder.MAX_TITLE_LENGTH, OutlineBuilder.trimTitle(long).length)
    val emojiAtCut = "x".repeat(OutlineBuilder.MAX_TITLE_LENGTH - 1) + "😀" + "tail"
    val cut = OutlineBuilder.trimTitle(emojiAtCut)
    assertEquals(OutlineBuilder.MAX_TITLE_LENGTH - 1, cut.length)
    assertTrue(cut.none { Character.isSurrogate(it) })
  }

  @Test
  fun nodeMapMatchesTheContract() {
    val node = OutlineNode("A", null, listOf(OutlineNode("B", 2, emptyList())))
    assertEquals(
      mapOf(
        "title" to "A",
        "page" to null,
        "children" to listOf(mapOf("title" to "B", "page" to 2, "children" to emptyList<Any>())),
      ),
      node.toMap(),
    )
  }
}
