const needsSetup = (settings) => settings.setupDone !== true;

function completeSetup(settings, covers) {
  settings.covers = covers === true;
  settings.setupDone = true;
}

module.exports = { needsSetup, completeSetup };
