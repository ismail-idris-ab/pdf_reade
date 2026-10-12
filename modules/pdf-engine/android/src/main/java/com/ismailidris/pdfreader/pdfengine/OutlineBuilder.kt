package com.ismailidris.pdfreader.pdfengine

/**
 * Read access to a document's bookmark tree. Items are opaque non-zero
 * handles; 0 means "none" (and, as a parent, the outline root).
 */
internal interface OutlineSource {
  fun firstChild(parent: Long): Long

  fun nextSibling(item: Long): Long

  fun title(item: Long): String

  /** 0-based target page, or null when the item has no in-document destination. */
  fun page(item: Long): Int?
}

internal data class OutlineNode(val title: String, val page: Int?, val children: List<OutlineNode>) {
  fun toMap(): Map<String, Any?> = mapOf("title" to title, "page" to page, "children" to children.map { it.toMap() })
}

/**
 * Builds the outline tree from an [OutlineSource]. Malformed files can link
 * bookmarks into cycles and arbitrarily deep chains, so the walk visits each
 * handle at most once, stops descending at [maxDepth] levels and stops
 * entirely after [maxItems] items. Pure; no PDFium.
 */
internal object OutlineBuilder {
  const val MAX_DEPTH = 32
  const val MAX_ITEMS = 10_000

  /** Titles are cut to this many UTF-16 units (never inside a surrogate pair). */
  const val MAX_TITLE_LENGTH = 512

  fun build(source: OutlineSource, maxDepth: Int = MAX_DEPTH, maxItems: Int = MAX_ITEMS): List<OutlineNode> {
    val walk = Walk(source, maxDepth, maxItems)
    return walk.children(parent = 0L, depth = 1)
  }

  fun trimTitle(title: String): String {
    val trimmed = title.trim()
    if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed
    val end = if (Character.isHighSurrogate(trimmed[MAX_TITLE_LENGTH - 1])) MAX_TITLE_LENGTH - 1 else MAX_TITLE_LENGTH
    return trimmed.substring(0, end)
  }

  private class Walk(val source: OutlineSource, val maxDepth: Int, val maxItems: Int) {
    val visited = HashSet<Long>()

    /** Children of [parent], which sit at [depth] (top level is 1). */
    fun children(parent: Long, depth: Int): List<OutlineNode> {
      if (depth > maxDepth) return emptyList()
      val nodes = ArrayList<OutlineNode>()
      var item = source.firstChild(parent)
      while (item != 0L && visited.size < maxItems && visited.add(item)) {
        val title = trimTitle(source.title(item))
        val page = source.page(item)
        nodes.add(OutlineNode(title, page, children(item, depth + 1)))
        item = source.nextSibling(item)
      }
      return nodes
    }
  }
}
