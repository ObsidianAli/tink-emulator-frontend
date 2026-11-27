const hintsBar = document.getElementById('hints');
let currentHints = [];

function setHints(hints) {
  currentHints = hints;
  hintsBar.replaceChildren(...hints.map(({ button, label }) => {
    const hint = document.createElement('span');
    hint.className = 'hint';
    const glyphs = [].concat(button).map((name) => {
      const glyph = document.createElement('span');
      glyph.className = 'glyph';
      glyph.textContent = name.toUpperCase();
      return glyph;
    });
    hint.append(...glyphs, label);
    return hint;
  }));
}

function getHints() {
  return currentHints;
}
