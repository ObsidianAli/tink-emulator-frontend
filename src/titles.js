// Turns a file name like "Legend of Zelda, The - Wind Waker (USA) [!].rvz" into a clean title.

// Games whose file name drops a word the real title has.
const FIXES = {
  'The Legend of Zelda: Wind Waker': 'The Legend of Zelda: The Wind Waker',
};

function cleanTitle(fileName, { isFolder = false } = {}) {
  let name = isFolder ? fileName : fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  // Region, version and dump tags: (USA), (Rev 1), [!], [b1] ...
  name = name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  name = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  // "Legend of Zelda, The" becomes "The Legend of Zelda", and " - " becomes ": ".
  const parts = name.split(' - ').map((part) => part.trim().replace(/^(.+), (The|A|An)$/, '$2 $1'));
  const title = parts.filter(Boolean).join(': ');
  return FIXES[title] || title || fileName;
}

module.exports = { cleanTitle };
