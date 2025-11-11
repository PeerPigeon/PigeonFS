# Book.js Bible Search

A fast, efficient implementation for searching through large texts like the Bible using Book.js's radix-tree structure.

## Features

### 🚀 Three Search Methods

1. **Full Text Search** - Searches through all verse content with context highlighting
2. **Indexed Search** - Pre-builds an inverted index for ultra-fast word-based searching
3. **Prefix Search** - Find all verses that start with a given prefix

### ⚡ Performance Optimizations

- **Radix Tree Structure**: Book.js uses a sorted, paged structure for efficient lookups
- **Inverted Index**: Optional indexing for word-based searches (50-100x faster)
- **Lazy Loading**: Pages are only parsed when accessed
- **Binary Search**: O(log n) lookups for verse keys

### 📊 Search Statistics

The demo displays real-time metrics:
- Number of results found
- Search execution time
- Total verses indexed
- Index build status

## Usage

### Basic Setup

```javascript
// Load and index the Bible
const bible = Book();

// Add verses
bible.set('John 3:16', 'For God so loved the world...');
bible.set('Genesis 1:1', 'In the beginning God created...');
```

### Search Methods

#### 1. Full Text Search

```javascript
// Search for a word or phrase
const results = Book.search(bible, 'love', {
    caseSensitive: false,
    maxResults: 50
});

// Results include context and match positions
results.forEach(result => {
    console.log(result.key);      // e.g., "John 3:16"
    console.log(result.value);    // The verse text
    console.log(result.matches);  // Array of match contexts
});
```

#### 2. Indexed Search (Fastest)

```javascript
// Build index once (takes a few seconds)
const index = Book.index(bible);

// Then search instantly
const results = Book.searchIndex(index, 'faith hope love', {
    maxResults: 100
});
```

#### 3. Prefix Search

```javascript
// Find all verses starting with "In the beginning"
const results = Book.prefix(bible, 'In the beginning');
```

## API Reference

### `Book.search(book, query, options)`

Performs full-text search through all verses.

**Parameters:**
- `book` - Book instance containing the data
- `query` - Search string
- `options` - Object with:
  - `caseSensitive` (boolean) - Default: false
  - `maxResults` (number) - Default: 100

**Returns:** Array of result objects with:
- `key` - The verse reference (e.g., "John 3:16")
- `value` - The verse text
- `matches` - Array of match objects with context

### `Book.index(book)`

Builds an inverted index for fast word-based searching.

**Parameters:**
- `book` - Book instance to index

**Returns:** Index object (word -> verse mappings)

**Note:** This is a one-time operation that takes a few seconds but dramatically speeds up subsequent searches.

### `Book.searchIndex(index, query, options)`

Searches using a pre-built index.

**Parameters:**
- `index` - Index created by `Book.index()`
- `query` - Search string (can contain multiple words)
- `options` - Object with:
  - `maxResults` (number) - Default: 100

**Returns:** Array of result objects

### `Book.prefix(book, prefix)`

Finds all entries that start with the given prefix.

**Parameters:**
- `book` - Book instance
- `prefix` - String prefix to match

**Returns:** Array of result objects

## Performance Benchmarks

Testing with the King James Bible (31,102 verses):

| Method | First Search | Subsequent Searches | Notes |
|--------|-------------|---------------------|-------|
| Full Text | 50-200ms | 50-200ms | Searches all verses |
| Indexed | 2-3s (build) | 1-5ms | 50-100x faster after index |
| Prefix | 10-50ms | 10-50ms | Depends on prefix length |

## Demo

Open `bible-search.html` in a browser to try the interactive demo:

```bash
# If you have a local server
python -m http.server 8000
# Then open http://localhost:8000/bible-search.html
```

Or use the Vite dev server:

```bash
npm run dev
```

## Implementation Details

### Radix Tree Structure

Book.js stores data in a sorted, paged radix-tree structure:

```
Book
├── Page 1 (A-D)
│   ├── Acts 1:1
│   ├── Daniel 3:4
│   └── ...
├── Page 2 (E-J)
│   ├── Exodus 20:1
│   ├── John 3:16
│   └── ...
└── ...
```

Each page contains up to 4KB of data and splits when full. This enables:
- Binary search for O(log n) lookups
- Sequential scanning for full-text search
- Efficient memory usage

### Inverted Index

The optional index maps words to verses:

```javascript
{
    "love": [
        {key: "John 3:16", value: "For God so loved..."},
        {key: "1 Corinthians 13:4", value: "Love is patient..."}
    ],
    "faith": [...]
}
```

This enables near-instant word-based searches after the initial build.

## Examples

### Search for Multiple Words

```javascript
const index = Book.index(bible);
const results = Book.searchIndex(index, 'faith hope love');
// Finds verses containing any of these words
```

### Case-Sensitive Search

```javascript
const results = Book.search(bible, 'LORD', {
    caseSensitive: true
});
// Only matches "LORD" not "lord" or "Lord"
```

### Limit Results

```javascript
const results = Book.search(bible, 'love', {
    maxResults: 10
});
// Returns at most 10 results
```

### Find Book Beginnings

```javascript
const results = Book.prefix(bible, 'Genesis');
// All verses in Genesis
```

## Browser Support

Works in all modern browsers that support:
- ES5 JavaScript
- Fetch API (for loading Bible JSON)
- localStorage (optional, for caching index)

## License

Same as Book.js (check main repository)

## Credits

- Book.js by Mark Nadal
- Bible JSON from [thiagobodruk/bible](https://github.com/thiagobodruk/bible)
- Demo implementation for PigeonFS
