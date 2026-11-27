const FIXES = {
  'The Legend of Zelda: Wind Waker': 'The Legend of Zelda: The Wind Waker',
};

function cleanTitle(fileName, { isFolder = false } = {}) {
  let name = isFolder ? fileName : fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  name = name.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
  name = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = name.split(' - ').map((part) => part.trim().replace(/^(.+), (The|A|An)$/, '$2 $1'));
  const title = parts.filter(Boolean).join(': ');
  return FIXES[title] || title || fileName;
}

module.exports = { cleanTitle };
