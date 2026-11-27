const STEAM = { name: 'Steam', colour: '#3b4654' };
const PC = { name: 'PC', colour: '#45524a' };

const coverColour = (kind) => (kind === 'pc' ? PC.colour : STEAM.colour);

module.exports = { STEAM, PC, coverColour };
