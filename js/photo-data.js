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
    return photos.map(photo => selected.has(photo.id) ? {...photo, collection: parent, subgroup: child, ...(group(photo)!==parent?{preview:false}:{})} : photo);
  }
  function rename(photos, parent, child, nextName) {
    nextName = name(nextName);
    if (!nextName || nextName.length > 100) throw Error('Enter a group name of 1–100 characters.');
    return photos.map(photo => matches(photo, parent, child) ? {...photo, [child === undefined ? 'collection' : 'subgroup']: nextName} : photo);
  }
  function preview(photos) {
    const included=photos.filter(p=>p.published!==false);
    const chosen=included.filter(p=>p.preview===true);
    return (chosen.length ? chosen : included).slice(0,4);
  }
  function setPreview(photos, ids) {
    const selected=new Set(ids), chosen=photos.filter(p=>selected.has(p.id));
    if(chosen.length>4) throw Error('Choose up to four photos for a category preview.');
    if(!chosen.length) throw Error('Select at least one photo.');
    const parent=group(chosen[0]);
    if(chosen.some(p=>group(p)!==parent)) throw Error('Choose photos from just one group for its preview.');
    if(chosen.some(p=>p.published===false)) throw Error('Include these photos on the site before choosing them for its preview.');
    return photos.map(p=>group(p)!==parent ? p : selected.has(p.id) ? {...p,preview:true} : p.preview ? {...p,preview:false} : p);
  }
  // Reorder only visible slots: filtered-out photos retain their exact positions.
  function reorder(photos, visibleIds, from, to) {
    const ids=new Set(visibleIds), shown=photos.filter(p=>ids.has(p.id));
    const start=shown.findIndex(p=>p.id===from), end=shown.findIndex(p=>p.id===to);
    if(start<0 || end<0 || start===end) return photos;
    shown.splice(end,0,shown.splice(start,1)[0]);
    let i=0; return photos.map(p=>ids.has(p.id)?shown[i++]:p);
  }
  function link(photos, parent, child, photoId, page=0) {
    const anchor=photos.find(p=>group(p)===parent);
    if(!anchor) return '';
    const params=new URLSearchParams({album:anchor.id,group:parent});
    if(child!==undefined) params.set('subgroup',child);
    if(photoId) params.set('photo',photoId);
    if(page>0) params.set('page',String(page));
    return '#'+params;
  }
  function resolveLink(photos, hash) {
    const params=new URLSearchParams(String(hash).replace(/^#/,''));
    const photo=photos.find(p=>p.id===params.get('photo'));
    const anchor=photo || photos.find(p=>p.id===params.get('album'));
    const parent=anchor?group(anchor):params.has('group')?params.get('group'):undefined;
    if(parent===undefined || !photos.some(p=>group(p)===parent)) return null;
    let child=params.has('subgroup')?params.get('subgroup'):undefined;
    if(child!==undefined && (!photos.some(p=>matches(p,parent,child)) || photo && subgroup(photo)!==child)) child=undefined;
    const page=Number(params.get('page'));
    return {parent,child,photoId:photo?.id || '',page:Number.isSafeInteger(page)&&page>0?page:0};
  }
  root.PhotoData = {group, subgroup, matches, grouped, move, rename, preview, setPreview, reorder, link, resolveLink};
  if (typeof module !== 'undefined') module.exports = root.PhotoData;
})(globalThis);
