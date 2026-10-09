'use strict';
(function (root) {
  function buildLogoBundle(images, playname) {
    const folders = ['BackPackPics', 'GloowallPics', 'HeadPics'];
    if (!images.length || !playname || !(playname.data instanceof Uint8Array)) throw new Error('Missing logos or playname');
    if (!playname.name || /[\\/]/.test(playname.name) || !playname.name.endsWith('.json')) throw new Error('Invalid playname filename');
    if (images.length * folders.length + 1 > 65535) throw new Error('Too many ZIP entries');
    const entries = folders.flatMap(folder => images.map(image => ({ name: folder + '/' + image.name, data: image.data })));
    entries.push(playname);
    return entries;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildLogoBundle };
  else root.buildLogoBundle = buildLogoBundle;
})(globalThis);
