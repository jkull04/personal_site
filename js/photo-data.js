((root) => {
  'use strict';
  const name = value => String(value || '').trim();
  const group = photo => name(photo.collection);
  const subgroup = photo => group(photo) ? name(photo.subgroup) : '';
  function matches(photo, parent, child) {
    return (parent === undefined || group(photo) === parent) && (child === undefined || subgroup(photo) === child);
  }
  function grouped(photos) {
    const groups = new Map();
    for (const photo of photos) {
      const parent = group(photo), child = subgroup(photo);
      if (!groups.has(parent)) groups.set(parent, new Map());
      const children = groups.get(parent);
      if (!children.has(child)) children.set(child, []);
      children.get(child).push(photo);
    }
    return [...groups].map(([name, children]) => ({name, subgroups: [...children].map(([name, photos]) => ({name, photos}))}));
  }
  function move(photos, ids, parent, child) {
    parent = name(parent); child = name(child);
    if (child && !parent) throw Error('Choose a group before adding a subgroup.');
    if (parent.length > 100 || child.length > 100) throw Error('Group names must be 100 characters or fewer.');
    const selected = new Set(ids);
    return photos.map(photo => selected.has(photo.id) ? {...photo, collection: parent, subgroup: child} : photo);
  }
  function rename(photos, parent, child, nextName) {
    nextName = name(nextName);
    if (!nextName || nextName.length > 100) throw Error('Enter a group name of 1–100 characters.');
    return photos.map(photo => matches(photo, parent, child) ? {...photo, [child === undefined ? 'collection' : 'subgroup']: nextName} : photo);
  }
  root.PhotoData = {group, subgroup, matches, grouped, move, rename};
  if (typeof module !== 'undefined') module.exports = root.PhotoData;
})(globalThis);
