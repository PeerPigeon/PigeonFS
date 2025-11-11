# 📖 Book.js Bible Search - Quick Start

Fast, efficient searching through the Bible (31,102 verses) using Book.js radix-tree structure.

## 🚀 Try It Now

```bash
npm run dev
```

Then open: **http://localhost:3000/bible-search.html**

## ✨ Features

- 🔍 **Three Search Methods**
  - Full-text search (comprehensive)
  - Indexed search (50-100x faster)
  - Prefix search (key-based)

- ⚡ **Performance**
  - Searches 31K verses in milliseconds
  - Real-time search statistics
  - Optimized radix-tree structure

- 🎨 **Beautiful UI**
  - Context highlighting
  - Responsive design
  - Performance metrics

## 📝 Quick Examples

### Full-Text Search
```javascript
const results = Book.search(bibleBook, 'love', {
    caseSensitive: false,
    maxResults: 50
});
```

### Indexed Search (Fastest)
```javascript
// Build index once
const index = Book.index(bibleBook);

// Search instantly
const results = Book.searchIndex(index, 'faith hope love');
```

### Prefix Search
```javascript
// Find all verses starting with "John"
const results = Book.prefix(bibleBook, 'John');
```

## 🧪 Test It

Open **test-search.html** to see all features tested automatically.

## 📚 Documentation

- **BIBLE_SEARCH.md** - Complete API reference
- **SEARCH_IMPLEMENTATION.md** - Implementation details

## 🎯 Performance

| Method | Speed | Best For |
|--------|-------|----------|
| Full-text | 50-200ms | Exact phrases |
| Indexed | 1-5ms | Word searches |
| Prefix | 10-50ms | Key lookups |

## 🔥 What's New in book.js

Added search functions:
- `Book.search()` - Full-text search with context
- `Book.index()` - Build inverted index
- `Book.searchIndex()` - Fast indexed search
- `Book.prefix()` - Prefix-based search

Enjoy! ✨
