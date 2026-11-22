// Stands in for an emulator that won't close when asked: it has no window, so only a forced close ends it.
// With "polite" it closes as soon as its input is closed, standing in for one that does close when asked.
if (process.argv[2] === 'polite') process.stdin.on('end', () => process.exit(0)).resume();
setInterval(() => {}, 1000);
