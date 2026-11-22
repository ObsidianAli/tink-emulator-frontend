// showDialog({ message, confirm = 'OK', cancel }) shows a friendly message and resolves true when confirm is chosen.
let activeDialog = null;

function showDialog({ message, confirm = 'OK', cancel }) {
  if (activeDialog) activeDialog.close(false);
  return new Promise((resolve) => {
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
      button.addEventListener('click', () => close(value));
      return button;
    });
    row.append(...buttons);
    box.append(text, row);
    scrim.append(box);
    document.body.append(scrim);

    const previousHints = getHints();
    setHints(cancel ? [{ button: 'a', label: 'Choose' }, { button: 'b', label: cancel }] : [{ button: 'a', label: confirm }]);
    let focused = 0;
    buttons[focused].focus();
    requestAnimationFrame(() => scrim.classList.add('open'));

    function close(value) {
      activeDialog = null;
      scrim.remove();
      setHints(previousHints);
      resolve(value);
    }

    function handle(action) {
      if (action === 'left' || action === 'right') {
        focused = Math.max(0, Math.min(buttons.length - 1, focused + (action === 'right' ? 1 : -1)));
        buttons[focused].focus();
      } else if (action === 'a') {
        close(focused === 0);
      } else if (action === 'b') {
        close(false);
      }
    }

    activeDialog = { close, handle };
  });
}

// Lets the open dialog take an input action. Returns false when no dialog is open.
function dialogTakesInput(action) {
  if (!activeDialog) return false;
  activeDialog.handle(action);
  return true;
}
