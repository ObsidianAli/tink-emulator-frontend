let activeDialog = null;

function overlayMs() {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--duration-fast'));
}

// Hands focus back without blocking: the overlay keeps fading out after this returns.
function returnFocus(from, overlay) {
  if (from && from.isConnected && from !== document.body) from.focus({ preventScroll: true });
  else if (overlay.contains(document.activeElement)) document.activeElement.blur();
}

function showDialog({ message, confirm = 'OK', cancel, sound = 'error' }) {
  if (activeDialog) activeDialog.close(false);
  return new Promise((resolve) => {
    playSound(sound);
    const scrim = document.createElement('div');
    scrim.className = 'dialog-scrim';
    const box = document.createElement('div');
    box.className = 'dialog';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    const text = document.createElement('p');
    text.textContent = message;
    const row = document.createElement('div');
    row.className = 'dialog-buttons';

    const choices = cancel ? [[confirm, true], [cancel, false]] : [[confirm, true]];
    const buttons = choices.map(([label, value]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      const glow = document.createElement('span');
      glow.className = 'focus-glow';
      glow.append(document.createElement('span'));
      button.append(glow);
      button.addEventListener('click', () => close(value));
      return button;
    });
    row.append(...buttons);
    box.append(text, row);
    scrim.append(box);
    document.body.append(scrim);

    const previousFocus = document.activeElement;
    const previousHints = getHints();
    setHints(cancel ? [{ button: 'a', label: 'Choose' }, { button: 'b', label: cancel }] : [{ button: 'a', label: confirm }]);
    let focused = 0;
    buttons[focused].focus();
    requestAnimationFrame(() => scrim.classList.add('open'));

    function close(value) {
      activeDialog = null;
      scrim.classList.remove('open');
      returnFocus(previousFocus, scrim);
      setTimeout(() => scrim.remove(), overlayMs());
      setHints(previousHints);
      resolve(value);
    }

    function handle(action) {
      if (action === 'left' || action === 'right') {
        const before = focused;
        focused = Math.max(0, Math.min(buttons.length - 1, focused + (action === 'right' ? 1 : -1)));
        buttons[focused].focus();
        return focused !== before ? 'list' : null;
      }
      if (action === 'a') {
        close(focused === 0);
        return 'confirm';
      }
      if (action === 'b') {
        close(false);
        return 'back';
      }
      return null;
    }

    activeDialog = { close, handle };
  });
}

function dialogTakesInput(action) {
  if (!activeDialog) return null;
  return { sound: activeDialog.handle(action) };
}
