// Test script for Book.js search functionality
// Run with: node test-search.js

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const B = require('./book.js');
const Book = B;

console.log('📖 Testing Book.js Search Functionality');
console.log('Book type:', typeof Book);
console.log('Book is:', Book);
console.log();

// Create a test book
const testBook = Book();

// Add sample Bible verses
const testData = {
    'Genesis 1:1': 'In the beginning God created the heaven and the earth.',
    'John 3:16': 'For God so loved the world, that he gave his only begotten Son.',
    'Psalm 23:1': 'The LORD is my shepherd; I shall not want.',
    'Matthew 5:9': 'Blessed are the peacemakers: for they shall be called the children of God.',
    'Romans 8:28': 'And we know that all things work together for good to them that love God.',
    'Philippians 4:13': 'I can do all things through Christ which strengtheneth me.',
    '1 Corinthians 13:4': 'Love is patient, love is kind.',
    'Proverbs 3:5': 'Trust in the LORD with all thine heart.',
    'Isaiah 41:10': 'Fear thou not; for I am with thee.',
    'James 1:2': 'My brethren, count it all joy when ye fall into divers temptations.'
};

console.log('✅ Adding test data...');
Object.keys(testData).forEach(key => {
    testBook.set(key, testData[key]);
});
console.log(`   Added ${Object.keys(testData).length} verses\n`);

// Test 1: Full text search
console.log('Test 1: Full Text Search for "love"');
console.time('   Search time');
const results1 = Book.search(testBook, 'love', { maxResults: 10 });
console.timeEnd('   Search time');
console.log(`   Found ${results1.length} results:`);
results1.forEach(r => {
    console.log(`   - ${r.key}: ${r.value.substring(0, 50)}...`);
});
console.log();

// Test 2: Case sensitive search
console.log('Test 2: Case-Sensitive Search for "LORD"');
console.time('   Search time');
const results2 = Book.search(testBook, 'LORD', { caseSensitive: true, maxResults: 10 });
console.timeEnd('   Search time');
console.log(`   Found ${results2.length} results:`);
results2.forEach(r => {
    console.log(`   - ${r.key}`);
});
console.log();

// Test 3: Prefix search
console.log('Test 3: Prefix Search for "John"');
console.time('   Search time');
const results3 = Book.prefix(testBook, 'John');
console.timeEnd('   Search time');
console.log(`   Found ${results3.length} results:`);
results3.forEach(r => {
    console.log(`   - ${r.key}`);
});
console.log();

// Test 4: Indexed search
console.log('Test 4: Building Index...');
console.time('   Index build time');
const index = Book.index(testBook);
console.timeEnd('   Index build time');
console.log(`   Index contains ${Object.keys(index).length} unique words\n`);

console.log('Test 5: Indexed Search for "God"');
console.time('   Search time');
const results4 = Book.searchIndex(index, 'God', { maxResults: 10 });
console.timeEnd('   Search time');
console.log(`   Found ${results4.length} results:`);
results4.forEach(r => {
    console.log(`   - ${r.key}: ${r.value.substring(0, 50)}...`);
});
console.log();

// Test 6: Multi-word indexed search
console.log('Test 6: Multi-word Indexed Search for "God love"');
console.time('   Search time');
const results5 = Book.searchIndex(index, 'God love', { maxResults: 10 });
console.timeEnd('   Search time');
console.log(`   Found ${results5.length} results:`);
results5.forEach(r => {
    console.log(`   - ${r.key}`);
});
console.log();

// Test 7: Performance comparison
console.log('Test 7: Performance Comparison (search for "the")');
console.time('   Full-text search');
Book.search(testBook, 'the', { maxResults: 100 });
console.timeEnd('   Full-text search');
console.time('   Indexed search');
Book.searchIndex(index, 'the', { maxResults: 100 });
console.timeEnd('   Indexed search');
console.log();

console.log('✅ All tests completed!');
console.log('\n💡 Tips:');
console.log('   - Use full-text search for exact phrase matching');
console.log('   - Use indexed search for fast word-based queries');
console.log('   - Use prefix search to find all entries starting with a key');
console.log('   - Build the index once and reuse it for multiple searches');
