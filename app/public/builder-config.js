/* Portable deployment configuration. It supplies presentation, never evidence
 * of image availability or qualification. No URL-controlled config loading. */
(function (root) {
  'use strict';
  const ID = /^[a-z0-9][a-z0-9-]*$/;
  const APP_ID = /^(?:[A-Za-z_][A-Za-z0-9_]*\.){2,}[A-Za-z_-][A-Za-z0-9_-]*$/;
  function validFlatpakId(id) { return typeof id === "string" && id.length <= 255 && APP_ID.exec(id)?.[0] === id; }
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
    object(config, ['schema_version','preview_only','brand','presentation','output','desktops','variants','default_selection','curated_app_sets','ddi_channels'], ['schema_version','preview_only','brand','presentation','output','desktops','variants','default_selection','curated_app_sets'], 'config');
    if (config.schema_version !== 1 || typeof config.preview_only !== 'boolean') fail('unsupported schema or preview_only');
    const b = config.brand;
    object(b, ['name','logo_url','favicon_url','homepage_url','documentation_url','support_url','disclaimer'], ['name','homepage_url','documentation_url'], 'brand');
    text(b.name, 'brand.name');
    for (const key of ['homepage_url','documentation_url','support_url']) if (key in b) url(b[key], `brand.${key}`);
    for (const key of ['logo_url','favicon_url']) if (key in b) url(b[key], `brand.${key}`, true);
    if ('disclaimer' in b) text(b.disclaimer, 'brand.disclaimer');
    if (config.preview_only && !b.disclaimer) fail('preview requires a disclaimer');
    object(config.presentation, ['headline','intro','accent_color'], ['headline','intro','accent_color'], 'presentation');
    text(config.presentation.headline, 'presentation.headline'); text(config.presentation.intro, 'presentation.intro');
    text(config.presentation.accent_color, 'accent_color');
    if (!/^#[0-9a-fA-F]{6}$/.test(config.presentation.accent_color)) fail('accent_color must be #RRGGBB');
    object(config.output, ['volume_label','filename_prefix'], ['volume_label','filename_prefix'], 'output');
    text(config.output.volume_label, 'volume_label'); text(config.output.filename_prefix, 'filename_prefix');
    if (!/^[A-Z0-9_]{1,32}$/.test(config.output.volume_label)) fail('invalid volume_label');
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(config.output.filename_prefix)) fail('invalid filename_prefix');
    list(config.desktops,'desktops'); list(config.variants,'variants'); list(config.curated_app_sets,'curated_app_sets');
    for (const d of config.desktops) {
      object(d, ['id','name','description','default_flatpaks'], ['id','name','description','default_flatpaks'], 'desktop');
      identifier(d.id,'desktop.id'); text(d.name,'desktop.name'); text(d.description,'desktop.description'); list(d.default_flatpaks,'default_flatpaks');
      if (d.default_flatpaks.some(id => !validFlatpakId(id))) fail('invalid Flatpak ID');
      unique(d.default_flatpaks,'default_flatpaks');
    }
    for (const v of config.variants) { object(v,['id','name'],['id','name'],'variant'); identifier(v.id,'variant.id'); text(v.name,'variant.name'); }
    unique(config.desktops.map(d=>d.id),'desktops'); unique(config.variants.map(v=>v.id),'variants');
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
    if (selection?.kind==='catalog') {
      object(selection,['kind','variant','flavor','platform'],['kind','variant','flavor','platform'],'default_selection');
      identifier(selection.variant,'default variant'); identifier(selection.flavor,'default flavor');
      if (!config.variants.some(v=>v.id===selection.variant) || !desktopIds.has(selection.flavor)) fail('default references unknown choice');
    } else if (selection?.kind==='image') {
      object(selection,['kind','image','platform'],['kind','image','platform'],'default_selection');
      if (typeof selection.image!=='string' || !/^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[0-9a-f]{64})$/.test(selection.image)) fail('invalid default image');
    } else fail('unsupported selection kind');
    if (!PLATFORMS.includes(selection.platform)) fail('unsupported default platform');
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
  function freeze(value) { if(value&&typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  function variants(config, snapshot) {
    return config.variants.map(v=>({...v,des:config.desktops.filter(d=>(snapshot.targets||[]).some(e=>e.target?.variant===v.id&&e.target?.flavor===d.id&&(e.scheduled||e.availability?.available))).map(d=>d.id)})).filter(v=>v.des.length);
  }
  const api={validate,variants,validFlatpakId};
  if (typeof module==='object'&&module.exports) module.exports=api;
  root.TboxBuilderConfig=api;
})(globalThis);
