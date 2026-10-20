/* Portable deployment configuration. It supplies presentation, never evidence
 * of image availability or qualification. No URL-controlled config loading. */
(function (root) {
  'use strict';
  const ID = /^[a-z0-9][a-z0-9-]*$/;
  const APP_ID = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2,}$/;
  const PLATFORMS = ['linux/amd64', 'linux/amd64/v2', 'linux/amd64/v3', 'linux/arm64'];
  function fail(message) { throw new Error(`Builder configuration: ${message}`); }
  function object(value, allowed, required, where) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${where} must be an object`);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${where}.${key} is unknown`);
    for (const key of required) if (!(key in value)) fail(`${where}.${key} is required`);
  }
  function text(value, where) {
    if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value)) fail(`${where} must be nonempty text`);
  }
  function url(value, where, asset = false) {
    text(value, where);
    if (/[\\\s]/.test(value)) fail(`${where} must not contain whitespace or backslashes`);
    if (asset && /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(value)) return;
    let parsed; try { parsed = new URL(value); } catch { fail(`${where} must be HTTPS`); }
    if (!/^https:\/\/[^\s/@\\:]+(?::443)?(?:[/?#][^\s\\]*)?$/.test(value) || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) fail(`${where} must be HTTPS without credentials or custom port`);
  }
  function list(value, where) { if (!Array.isArray(value)) fail(`${where} must be an array`); }
  function unique(items, where) { if (new Set(items).size !== items.length) fail(`${where} has duplicate entries`); }
  function identifier(value, where) { if (typeof value !== 'string' || !ID.test(value)) fail(`${where} is not an identifier`); }
  function validate(config) {
    const guided = config?.schema_version === 2;
    const required = ['schema_version','preview_only','brand','presentation','output','desktops','default_selection','curated_app_sets', guided ? 'selection' : 'variants'];
    object(config, [...required,'ddi_channels'], required, 'config');
    if (![1,2].includes(config.schema_version) || typeof config.preview_only !== 'boolean') fail('unsupported schema or preview_only');
    const b = config.brand;
    object(b, ['name','logo_url','favicon_url','homepage_url','documentation_url','support_url','disclaimer'], ['name','homepage_url','documentation_url'], 'brand');
    text(b.name, 'brand.name');
    for (const key of ['homepage_url','documentation_url','support_url']) if (key in b) url(b[key], `brand.${key}`);
    for (const key of ['logo_url','favicon_url']) if (key in b) url(b[key], `brand.${key}`, true);
    if ('disclaimer' in b) text(b.disclaimer, 'brand.disclaimer');
    if (config.preview_only && !b.disclaimer) fail('preview requires a disclaimer');
    object(config.presentation, ['headline','intro','accent_color',...(guided?['colors','choice_style','font_family']:[])], ['headline','intro','accent_color'], 'presentation');
    text(config.presentation.headline, 'presentation.headline'); text(config.presentation.intro, 'presentation.intro');
    text(config.presentation.accent_color, 'accent_color');
    if (!/^#[0-9a-fA-F]{6}$/.test(config.presentation.accent_color)) fail('accent_color must be #RRGGBB');
    if ('choice_style' in config.presentation && !['illustrated','thumbnail'].includes(config.presentation.choice_style))fail('invalid choice_style');
    if ('font_family' in config.presentation && !['system','inter','dm-sans'].includes(config.presentation.font_family))fail('invalid font_family');
    if ('colors' in config.presentation) {
      const keys=['background','surface','text','muted','accent','accent_text'];
      object(config.presentation.colors,[...keys,'border','hover_surface','focus','selected_surface'],keys,'colors');
      for(const value of Object.values(config.presentation.colors)) if(typeof value!=='string'||!/^#[0-9a-fA-F]{6}$/.test(value))fail('colors must be #RRGGBB');
    }
    object(config.output, ['volume_label','filename_prefix'], ['volume_label','filename_prefix'], 'output');
    text(config.output.volume_label, 'volume_label'); text(config.output.filename_prefix, 'filename_prefix');
    if (!/^[A-Z0-9_]{1,32}$/.test(config.output.volume_label)) fail('invalid volume_label');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(config.output.filename_prefix)) fail('invalid filename_prefix');
    list(config.desktops,'desktops'); if (!guided) list(config.variants,'variants'); list(config.curated_app_sets,'curated_app_sets');
    for (const d of config.desktops) {
      const fields=guided?['id','default_flatpaks']:['id','name','description','default_flatpaks'];
      object(d,fields,fields,'desktop');
      identifier(d.id,'desktop.id'); if (!guided) { text(d.name,'desktop.name'); text(d.description,'desktop.description'); } list(d.default_flatpaks,'default_flatpaks');
      if (d.default_flatpaks.some(id => typeof id !== 'string' || !APP_ID.test(id))) fail('invalid Flatpak ID');
      unique(d.default_flatpaks,'default_flatpaks');
    }
    for (const v of config.variants || []) { object(v,['id','name'],['id','name'],'variant'); identifier(v.id,'variant.id'); text(v.name,'variant.name'); }
    unique(config.desktops.map(d=>d.id),'desktops'); unique((config.variants || []).map(v=>v.id),'variants');
    const desktopIds = new Set(config.desktops.map(d=>d.id));
    for (const set of config.curated_app_sets) {
      object(set,['id','label','desktops','url','format'],['id','label','desktops','url','format'],'curated_app_set');
      identifier(set.id,'set.id'); text(set.label,'set.label'); url(set.url,'set.url'); list(set.desktops,'set.desktops');
      unique(set.desktops, 'set.desktops');
      if (set.desktops.some(id=>!desktopIds.has(id))) fail('collection references unknown desktop');
      if (!['brewfile','preinstall'].includes(set.format)) fail('unsupported collection format');
    }
    unique(config.curated_app_sets.map(s=>s.id),'curated_app_sets');
    const selection=config.default_selection;
    if (guided) {
      validateSelection(config.selection, desktopIds);
      if (selection?.kind === 'leaf') { object(selection,['kind','leaf_id'],['kind','leaf_id'],'default_selection'); leafId(selection.leaf_id,'default leaf'); }
      else if (selection?.kind === 'none') object(selection,['kind'],['kind'],'default_selection');
      else fail('v2 default_selection must identify a leaf or none');
    } else if (selection?.kind==='catalog') {
      object(selection,['kind','variant','flavor','platform'],['kind','variant','flavor','platform'],'default_selection');
      identifier(selection.variant,'default variant'); identifier(selection.flavor,'default flavor');
      if (!config.variants.some(v=>v.id===selection.variant) || !desktopIds.has(selection.flavor)) fail('default references unknown choice');
    } else if (selection?.kind==='image') {
      object(selection,['kind','image','platform'],['kind','image','platform'],'default_selection');
      text(selection.image, 'default image');
      if (!/^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}(?:@sha256:[0-9a-f]{64})?|@sha256:[0-9a-f]{64})$/.test(selection.image)) fail('invalid default image');
    } else fail('unsupported selection kind');
    if (!guided && !PLATFORMS.includes(selection.platform)) fail('unsupported default platform');
    if ('ddi_channels' in config) {
      list(config.ddi_channels,'ddi_channels');
      for (const ch of config.ddi_channels) {
        object(ch,['id','stem','name','desktop'],['id','stem','name','desktop'],'ddi_channel');
        identifier(ch.id,'channel.id'); identifier(ch.stem,'channel.stem'); text(ch.name,'channel.name');
        if (ch.desktop!=='none'&&!desktopIds.has(ch.desktop)) fail('DDI references unknown desktop');
      }
      unique(config.ddi_channels.map(c=>c.id),'ddi_channels');
    }
    return freeze(config);
  }
  function selectionText(value,where){text(value,where);if(value.length>2048||/[<>]/.test(value))fail(`${where} must be bounded plain text`);}
  function selectionId(value,where){identifier(value,where);if(value.length>64)fail(`${where} is too long`);}
  function leafId(value,where){if(typeof value!=='string'||!/^[a-z0-9][a-z0-9._:/-]{0,191}$/.test(value))fail(`${where} is not a leaf ID`);}
  const FACETS=['family','base','desktop','hardware','platform','graphics','edition','gaming_mode','channel','graphics_generation'];
  function validateSelection(selection, desktopIds) {
    object(selection,['paths','default_path','facets','recommendations'],['paths','default_path','facets','recommendations'],'selection');
    list(selection.paths,'selection.paths'); list(selection.facets,'selection.facets'); list(selection.recommendations,'selection.recommendations');
    if(selection.paths.length<1||selection.paths.length>4||selection.facets.length<1||selection.facets.length>10||selection.recommendations.length>8) fail('selection bounds exceeded');
    for(const facet of selection.facets) {
      object(facet,['id','label','description','values'],['id','label','values'],'facet');
      if(!FACETS.includes(facet.id))fail('unknown facet');selectionText(facet.label,'facet.label');if('description'in facet)selectionText(facet.description,'facet.description');list(facet.values,'facet.values');if(facet.values.length<1||facet.values.length>256)fail('facet values bounds exceeded');
      for(const value of facet.values) {object(value,['id','label','description','card'],['id','label'],'facet value');if('card'in value){object(value.card,['image_url','image_alt','badge'],['image_url','image_alt'],'card');url(value.card.image_url,'card.image_url',true);selectionText(value.card.image_alt,'card.image_alt');if('badge'in value.card)selectionText(value.card.badge,'card.badge');}if(facet.id==='platform'){if(!PLATFORMS.includes(value.id))fail('unknown platform');}else selectionId(value.id,'facet value.id');selectionText(value.label,'facet value.label');if('description'in value)selectionText(value.description,'facet value.description');}
      unique(facet.values.map(v=>v.id),'facet values');
    }
    unique(selection.facets.map(f=>f.id),'facets');
    const known=new Set(selection.facets.map(f=>f.id));
    for(const path of selection.paths) {object(path,['id','label','facets'],['id','label','facets'],'path');selectionId(path.id,'path.id');selectionText(path.label,'path.label');list(path.facets,'path.facets');if(!path.facets.length||path.facets.some(f=>!known.has(f)))fail('path references unknown facet');unique(path.facets,'path facets');}
    unique(selection.paths.map(p=>p.id),'paths');if(!selection.paths.some(p=>p.id===selection.default_path))fail('unknown default path');
    for(const item of selection.recommendations){object(item,['leaf_id','label','reason'],['leaf_id','label','reason'],'recommendation');leafId(item.leaf_id,'recommendation leaf');selectionText(item.label,'recommendation label');selectionText(item.reason,'recommendation reason');}
    unique(selection.recommendations.map(r=>r.leaf_id),'recommendations');
    const desktops=new Set(selection.facets.find(f=>f.id==='desktop')?.values.map(v=>v.id)||[]);
    if([...desktopIds].some(id=>!desktops.has(id)))fail('app defaults reference unknown desktop facet');
  }
  function freeze(value) { if(value&&typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  function variants(config, snapshot) {
    if(config.schema_version===2) return (config.selection.facets.find(f=>f.id==='base')?.values||[]).map(v=>({id:v.id,name:v.label,des:config.desktops.filter(d=>(snapshot.targets||[]).some(e=>e.target?.variant===v.id&&e.target?.flavor===d.id&&(e.scheduled||e.availability?.available))).map(d=>d.id)})).filter(v=>v.des.length);
    return config.variants.map(v=>({...v,des:config.desktops.filter(d=>(snapshot.targets||[]).some(e=>e.target?.variant===v.id&&e.target?.flavor===d.id&&(e.scheduled||e.availability?.available))).map(d=>d.id)})).filter(v=>v.des.length);
  }
  const api={validate,variants};
  if (typeof module==='object'&&module.exports) module.exports=api;
  root.TboxBuilderConfig=api;
})(globalThis);
