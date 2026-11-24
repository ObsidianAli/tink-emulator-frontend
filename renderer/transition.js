const overlay = document.createElement('div');
overlay.id = 'blackout';
document.body.append(overlay);

const main = document.querySelector('main');

const duration = (node, name) => parseFloat(getComputedStyle(node).getPropertyValue(name)) || 0;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

let queue = Promise.resolve();
let changing = 0;

function enqueue(job) {
  const run = queue.then(job);
  queue = run.catch(() => {});
  return run;
}

// Resolves as the fade-in starts, not when it ends, so input works again straight away.
export function transition(build) {
  return enqueue(async () => {
    overlay.classList.add('black');
    await wait(duration(overlay, '--duration-to-black'));
    try {
      await build();
      // One frame for the new screen to be drawn and one for it to be on screen before the black lifts.
      await nextFrame();
      await nextFrame();
    } finally {
      overlay.classList.remove('black');
    }
  });
}

export const changingScreen = () => changing > 0;

export function screen(build) {
  changing++;
  return enqueue(async () => {
    try {
      main.classList.add('screen-out');
      await wait(duration(main, '--duration-screen-out'));
      main.classList.add('screen-hold');
      main.classList.remove('screen-out');
      await build();
      await nextFrame();
      await nextFrame();
    } finally {
      main.classList.remove('screen-hold');
      changing--;
    }
  });
}
