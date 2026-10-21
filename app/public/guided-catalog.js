/* One catalog, many question orders. Presentation is never build evidence.
 * This module does not inspect images or decide browser qualification. */
(function (root) {
  'use strict';

  const FACETS = Object.freeze(['family', 'base', 'desktop', 'hardware', 'platform', 'graphics', 'edition', 'gaming_mode', 'channel', 'graphics_generation']);
  const PLATFORMS = Object.freeze(['linux/amd64', 'linux/amd64/v2', 'linux/amd64/v3', 'linux/arm64']);
  const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
  const DIGEST = /^sha256:[a-f0-9]{64}$/;
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function fail(message) { throw new Error(`Guided catalog: ${message}`); }
  function object(value, allowed, required, where) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(`${where} must be a plain object`);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${where}.${key} is unknown`);
    for (const key of required) if (!own(value, key)) fail(`${where}.${key} is required`);
  }
  function text(value, where, limit = 2048) {
    if (typeof value !== 'string' || !value.trim() || value.length > limit ||
        /[\x00-\x1f\x7f<>]/.test(value)) fail(`${where} must be bounded plain text`);
  }
  function identifier(value, where) {
    if (typeof value !== 'string' || !ID.test(value)) fail(`${where} is not a bounded identifier`);
  }
  function leafId(value, where) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9._:/-]{0,191}$/.test(value)) fail(`${where} is not a bounded leaf ID`);
  }
  function list(value, min, max, where) {
    if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${where} must have ${min}..${max} items`);
  }
  function unique(values, where) {
    if (new Set(values).size !== values.length) fail(`${where} has duplicate entries`);
  }
  function platform(value, where) {
    if (!PLATFORMS.includes(value)) fail(`${where} is not a supported platform`);
  }
  function timestamp(value, where) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(`${where} must be a valid UTC timestamp`);
  }
  function https(value, where) {
    text(value, where, 2048);
    let parsed;
    try { parsed = new URL(value); } catch { fail(`${where} must be HTTPS`); }
    if (!/^https:\/\/[^\s/@\\:]+(?::443)?(?:[/?#][^\s\\]*)?$/.test(value) ||
        parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.port) fail(`${where} must be HTTPS without credentials or custom port`);
  }
  function reference(value, where) {
    text(value, where, 1024);
    // Fully qualified OCI references only; never synthesize a repository/tag.
    const component = '[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*';
    const hostLabel = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
    const registry = `${hostLabel}(?:\\.${hostLabel})+(?::[0-9]{1,5})?`;
    const ref = new RegExp(`^${registry}/${component}(?:/${component})*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[a-f0-9]{64})$`);
    if (!ref.test(value)) fail(`${where} must be a canonical OCI reference`);
    const port = value.split('/')[0].split(':')[1];
    if (port && (Number(port) < 1 || Number(port) > 65535)) fail(`${where} has an invalid registry port`);
  }
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
    return value;
  }
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  function facetValue(facet, value, where) {
    if (facet === 'platform') platform(value, where);
    else identifier(value, where);
  }
  function validateFacets(facets, where) {
    object(facets, FACETS, [], where);
    if (Object.keys(facets).length > 10) fail(`${where} has too many facets`);
    for (const [key, values] of Object.entries(facets)) {
      list(values, 1, 16, `${where}.${key}`);
      unique(values, `${where}.${key}`);
      values.forEach(value => facetValue(key, value, `${where}.${key}`));
    }
  }
  function derivedFacets(entry, flavorMetadata) {
    const target = entry.target;
    if (!target || typeof target !== 'object') fail(`target ${entry.targetKey} has no target fields`);
    identifier(target.variant, 'target.variant');
    identifier(target.flavor, 'target.flavor');
    identifier(target.hardwareScope, 'target.hardwareScope');
    platform(target.platform, 'target.platform');
    if (!flavorMetadata || !own(flavorMetadata, target.flavor)) fail(`missing primary flavor metadata for ${target.flavor}`);
    const meta = flavorMetadata[target.flavor];
    object(meta, ['desktop', 'edition'], ['desktop', 'edition'], 'flavor metadata');
    identifier(meta.desktop, 'flavor metadata.desktop');
    identifier(meta.edition, 'flavor metadata.edition');
    return {
      base: [target.variant], platform: [target.platform], hardware: [target.hardwareScope],
      desktop: [meta.desktop], edition: [meta.edition],
    };
  }

  /**
   * Validate GuidedCatalog v1 and join targetKey against the exact snapshot.
   * flavorMetadata is the reviewed primary flavor -> {desktop, edition} map.
   * isOffered is the caller's existing admission policy. Without it, target
   * records remain visible but are never selectable. No build gate is copied.
   */
  function validate(catalog, snapshot, options = {}) {
    object(catalog, ['schemaVersion', 'kind', 'catalogId', 'generatedAt', 'snapshotDigest', 'leaves'],
      ['schemaVersion', 'kind', 'catalogId', 'generatedAt', 'snapshotDigest', 'leaves'], 'catalog');
    if (catalog.schemaVersion !== 1 || catalog.kind !== 'guided-image-catalog') fail('unsupported catalog schema');
    identifier(catalog.catalogId, 'catalog.catalogId');
    timestamp(catalog.generatedAt, 'catalog.generatedAt');
    if (catalog.snapshotDigest !== null && (typeof catalog.snapshotDigest !== 'string' || !DIGEST.test(catalog.snapshotDigest))) fail('invalid snapshotDigest');
    list(catalog.leaves, 1, 4096, 'catalog.leaves');
    if (options.isOffered !== undefined && typeof options.isOffered !== 'function') fail('isOffered must be a function');
    const targets = new Map();
    const hasTargets = catalog.leaves.some(leaf => leaf?.source?.kind === 'target');
    if (hasTargets) {
      if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.kind !== 'catalog-snapshot' ||
          !Array.isArray(snapshot.targets) || !DIGEST.test(snapshot.snapshotDigest || '') ||
          catalog.snapshotDigest !== snapshot.snapshotDigest) fail('snapshotDigest does not bind this CatalogSnapshot v1');
      for (const entry of snapshot.targets) {
        leafId(entry?.targetKey, 'snapshot targetKey');
        if (targets.has(entry.targetKey)) fail(`duplicate snapshot targetKey ${entry.targetKey}`);
        targets.set(entry.targetKey, entry);
      }
    } else if (catalog.snapshotDigest !== null) {
      fail('a preview-only catalog must have snapshotDigest null');
    }
    const ids = new Set();
    const previewTuples = new Set();
    const leaves = catalog.leaves.map((leaf, index) => {
      const where = `leaves[${index}]`;
      object(leaf, ['id', 'source', 'facets', 'notices'], ['id', 'source', 'facets', 'notices'], where);
      leafId(leaf.id, `${where}.id`);
      if (ids.has(leaf.id)) fail(`duplicate leaf ID ${leaf.id}`);
      ids.add(leaf.id);
      validateFacets(leaf.facets, `${where}.facets`);
      list(leaf.notices, 0, 8, `${where}.notices`);
      for (const notice of leaf.notices) {
        object(notice, ['code', 'text', 'sourceUrl', 'requiresAcknowledgement'], ['code', 'text'], 'notice');
        identifier(notice.code, 'notice.code');
        text(notice.text, 'notice.text');
        if (own(notice, 'sourceUrl')) https(notice.sourceUrl, 'notice.sourceUrl');
        if (own(notice, 'requiresAcknowledgement') && typeof notice.requiresAcknowledgement !== 'boolean') fail('notice.requiresAcknowledgement must be a boolean');
      }
      let facets = clone(leaf.facets);
      let entry = null;
      let available = false;
      let selectable = false;
      let unavailableReason = null;
      if (leaf.source?.kind === 'target') {
        object(leaf.source, ['kind', 'targetKey'], ['kind', 'targetKey'], `${where}.source`);
        leafId(leaf.source.targetKey, 'source.targetKey');
        if (leaf.id !== leaf.source.targetKey) fail('target leaf ID must equal its targetKey');
        const original = targets.get(leaf.source.targetKey);
        if (!original) fail(`dangling targetKey ${leaf.source.targetKey}`);
        const derived = derivedFacets(original, options.flavorMetadata);
        for (const [key, values] of Object.entries(facets)) {
          if (!own(derived, key) || canonical(values) !== canonical(derived[key])) fail(`contradictory or unverified target facet ${key} for ${leaf.id}`);
        }
        facets = derived;
        // Copy before calling external policy, so validation never mutates or
        // freezes the engine's original CatalogSnapshot evidence.
        entry = freeze(clone(original));
        available = entry.availability?.available === true;
        const offered = typeof options.isOffered === 'function' && options.isOffered(entry) === true;
        selectable = available && offered;
        unavailableReason = !available ? 'This image is not currently available.' :
          !offered ? 'This image is not offered by this deployment.' : null;
      } else if (leaf.source?.kind === 'preview') {
        object(leaf.source, ['kind', 'ref', 'platform', 'evidence'], ['kind', 'ref', 'platform', 'evidence'], `${where}.source`);
        if (options.previewOnly !== true) fail('preview leaves require preview_only=true');
        reference(leaf.source.ref, 'preview.ref');
        platform(leaf.source.platform, 'preview.platform');
        list(leaf.source.evidence, 1, 8, 'preview.evidence');
        const claims = new Set();
        for (const evidence of leaf.source.evidence) {
          object(evidence, ['url', 'checkedAt', 'claims'], ['url', 'checkedAt', 'claims'], 'evidence');
          https(evidence.url, 'evidence.url');
          timestamp(evidence.checkedAt, 'evidence.checkedAt');
          list(evidence.claims, 1, 5, 'evidence.claims');
          unique(evidence.claims, 'evidence.claims');
          for (const claim of evidence.claims) {
            if (!['ref', 'platform', 'hardware', 'channel', 'desktop'].includes(claim)) fail('unknown documentation evidence claim');
            claims.add(claim);
          }
        }
        if (!claims.has('ref') || !claims.has('platform')) fail('preview documentation must cover ref and platform');
        const tuple = `${leaf.source.ref}\n${leaf.source.platform}`;
        if (previewTuples.has(tuple)) fail('duplicate preview ref/platform tuple');
        previewTuples.add(tuple);
        if (own(facets, 'platform') && canonical(facets.platform) !== canonical([leaf.source.platform])) fail('contradictory preview platform facet');
        facets.platform = [leaf.source.platform];
        // Selectable means reviewable only. Previews have no availability or
        // qualification evidence and never acquire a snapshot entry.
        selectable = true;
      } else {
        fail(`${where}.source.kind is unsupported`);
      }
      return {
        id: leaf.id, source: clone(leaf.source), facets, notices: clone(leaf.notices),
        entry, available, selectable, unavailableReason,
        // Catalog-owned compatibility facts and acknowledgement text are part
        // of the identity's review evidence. Presentation labels are not.
        evidenceKey: canonical({ source: leaf.source, facets, notices: leaf.notices, entry }),
      };
    });
    return freeze({ catalogId: catalog.catalogId, snapshotDigest: catalog.snapshotDigest, generatedAt: catalog.generatedAt, leaves });
  }

  /** config must already pass the deployment's builder-config v2 validator. */
  function createModel(catalog, snapshot, config, options = {}) {
    if (config?.schema_version !== 2 || typeof config.preview_only !== 'boolean') fail('createModel requires builder configuration v2');
    const joined = validate(catalog, snapshot, { ...options, previewOnly: config.preview_only });
    const selection = config.selection;
    object(selection, ['paths', 'default_path', 'facets', 'recommendations'], ['paths', 'default_path', 'facets', 'recommendations'], 'selection');
    list(selection.paths, 1, 4, 'selection.paths');
    list(selection.facets, 1, 10, 'selection.facets');
    list(selection.recommendations, 0, 8, 'selection.recommendations');
    const presentation = {};
    for (const facet of selection.facets) {
      object(facet, ['id', 'label', 'description', 'values'], ['id', 'label', 'values'], 'selection facet');
      if (!FACETS.includes(facet.id)) fail('unknown presentation facet');
      if (own(presentation, facet.id)) fail('duplicate presentation facet');
      text(facet.label, 'facet.label');
      if (own(facet, 'description')) text(facet.description, 'facet.description');
      list(facet.values, 1, 256, 'facet.values');
      unique(facet.values.map(value => value.id), 'facet.values');
      for (const value of facet.values) {
        object(value, ['id', 'label', 'description', 'card'], ['id', 'label'], 'facet value');
        facetValue(facet.id, value.id, 'facet value.id');
        text(value.label, 'facet value.label');
        if (own(value, 'description')) text(value.description, 'facet value.description');
        if (own(value, 'card')) {
          object(value.card, ['image_url', 'image_alt', 'badge'], ['image_url', 'image_alt'], 'facet value.card');
          text(value.card.image_alt, 'card.image_alt');
          if (own(value.card, 'badge')) text(value.card.badge, 'card.badge');
          const asset = value.card.image_url;
          if (typeof asset !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(asset)) https(asset, 'card.image_url');
        }
      }
      presentation[facet.id] = clone(facet);
    }
    for (const path of selection.paths) {
      object(path, ['id', 'label', 'facets'], ['id', 'label', 'facets'], 'selection path');
      identifier(path.id, 'path.id');
      text(path.label, 'path.label');
      list(path.facets, 1, 10, 'path.facets');
      unique(path.facets, 'path.facets');
      if (path.facets.some(facet => !own(presentation, facet))) fail('path references an unknown presentation facet');
    }
    unique(selection.paths.map(path => path.id), 'selection.paths');
    if (!selection.paths.some(path => path.id === selection.default_path)) fail('default path is unknown');
    for (const rec of selection.recommendations) {
      object(rec, ['leaf_id', 'label', 'reason'], ['leaf_id', 'label', 'reason'], 'recommendation');
      leafId(rec.leaf_id, 'recommendation.leaf_id');
      text(rec.label, 'recommendation.label');
      text(rec.reason, 'recommendation.reason');
      if (!joined.leaves.some(leaf => leaf.id === rec.leaf_id)) fail('recommendation references an unknown leaf');
    }
    unique(selection.recommendations.map(rec => rec.leaf_id), 'selection.recommendations');
    const defaults = config.default_selection;
    if (defaults?.kind === 'leaf') {
      object(defaults, ['kind', 'leaf_id'], ['kind', 'leaf_id'], 'default_selection');
      leafId(defaults.leaf_id, 'default_selection.leaf_id');
    } else {
      object(defaults, ['kind'], ['kind'], 'default_selection');
      if (defaults.kind !== 'none') fail('unsupported default selection');
    }
    const leaves = joined.leaves.flatMap(leaf => {
      const facets = clone(leaf.facets);
      for (const [key, facet] of Object.entries(presentation)) {
        // Conditional questions can be inapplicable. Absence is retained here,
        // but matches() never treats absence as satisfying a chosen predicate.
        if (!own(facets, key)) continue;
        const allowed = new Set(facet.values.map(value => value.id));
        const values = facets[key].filter(value => allowed.has(value));
        if (!values.length) return [];
        facets[key] = values;
      }
      return [{ ...leaf, facets }];
    });
    return freeze({
      ...joined, leaves, paths: clone(selection.paths), defaultPath: selection.default_path,
      facetPresentation: presentation, recommendations: clone(selection.recommendations),
      defaultSelection: clone(defaults), previewOnly: config.preview_only,
    });
  }

  function filtersOf(stateOrFilters) { return stateOrFilters?.filters || stateOrFilters || {}; }
  function matches(leaf, filters) {
    return Object.entries(filters).every(([facet, value]) => leaf.facets[facet]?.includes(value));
  }
  function candidates(model, stateOrFilters = {}, options = {}) {
    const filters = filtersOf(stateOrFilters);
    return model.leaves.filter(leaf => (options.includeUnavailable === true || leaf.selectable) && matches(leaf, filters));
  }
  function facetOptions(model, state, facetId) {
    if (!FACETS.includes(facetId)) fail('unknown facet');
    const filters = { ...filtersOf(state) };
    delete filters[facetId];
    const values = new Set(model.leaves.flatMap(leaf => leaf.facets[facetId] || []));
    const configured = model.facetPresentation?.[facetId]?.values;
    const ordering = configured || [...values].sort().map(id => ({ id, label: id }));
    return freeze(ordering.filter(value => values.has(value.id)).map(value => {
      const count = candidates(model, { ...filters, [facetId]: value.id }).length;
      const unavailable = candidates(model, { ...filters, [facetId]: value.id }, { includeUnavailable: true }).length;
      return {
        ...value, count, disabled: count === 0, selected: filtersOf(state)[facetId] === value.id,
        reason: count ? null : unavailable ? 'Matching images are not currently available in this deployment.' : 'No image matches this choice and the other selected options.',
      };
    }));
  }
  function unavailable(model, state) {
    if (!state.selectedLeafId) return null;
    const leaf = model.leaves.find(item => item.id === state.selectedLeafId);
    const reason = !leaf ? 'The selected image is no longer available in this catalog.' :
      !leaf.selectable ? leaf.unavailableReason || 'The selected image cannot be selected in this deployment.' :
      !matches(leaf, state.filters) ? 'The selected image does not match the selected options.' : null;
    return reason ? { leafId: state.selectedLeafId, reason } : null;
  }
  function initialState(model) {
    const state = {
      pathId: model.defaultPath, filters: {}, selectedLeafId: model.defaultSelection.kind === 'leaf' ? model.defaultSelection.leaf_id : null,
      origin: model.defaultSelection.kind === 'leaf' ? 'default' : null, unavailable: null, facetOrder: [],
    };
    state.unavailable = unavailable(model, state);
    return freeze(state);
  }
  function result(state, ok = true, reason = null, conflict = null) { return freeze({ ok, state, reason, conflict }); }
  function compatibleState(model, state, filters, facetOrder) {
    const selected = model.leaves.find(leaf => leaf.id === state.selectedLeafId);
    const keep = selected && selected.selectable && matches(selected, filters);
    return freeze({
      ...state, filters, facetOrder, selectedLeafId: keep ? state.selectedLeafId : null,
      origin: keep ? state.origin : null, unavailable: null,
    });
  }
  /**
   * Conflicts preserve the largest possible set of other predicates. Ties
   * prefer the most recently chosen compatible predicates, independent of
   * path order. Nothing is cleared until confirmConflicts is explicitly true.
   */
  function chooseFacet(model, state, facetId, value, options = {}) {
    if (!FACETS.includes(facetId)) return result(state, false, 'Unknown facet.');
    if (!facetOptions(model, { filters: {} }, facetId).some(item => item.id === value && !item.disabled)) {
      return result(state, false, 'This choice has no currently selectable image.');
    }
    const filters = { ...state.filters, [facetId]: value };
    const order = [...state.facetOrder.filter(key => key !== facetId), facetId];
    if (candidates(model, filters).length) return result(compatibleState(model, state, filters, order));
    const others = order.filter(key => key !== facetId && own(state.filters, key)).reverse();
    // At most ten known facets: exhaustive masks remain small and guarantee
    // the fewest cleared predicates, rather than a destructive greedy reset.
    let best = null;
    for (let mask = 0; mask < (1 << others.length); mask++) {
      const kept = others.filter((_, index) => mask & (1 << index));
      const proposed = { [facetId]: value };
      kept.forEach(key => { proposed[key] = state.filters[key]; });
      if (!candidates(model, proposed).length) continue;
      const rank = kept.length;
      const recency = others.reduce((score, _, index) => score * 2 + Number(Boolean(mask & (1 << index))), 0);
      if (!best || rank > best.rank || (rank === best.rank && recency > best.recency)) best = { proposed, kept, rank, recency };
    }
    if (!best) return result(state, false, 'This choice has no currently selectable image.');
    const affected = Object.keys(state.filters).filter(key => key !== facetId && !best.kept.includes(key)).map(key => ({ facetId: key, value: state.filters[key] }));
    const proposedState = compatibleState(model, state, best.proposed, order.filter(key => own(best.proposed, key)));
    if (options.confirmConflicts === true) return result(proposedState);
    return result(state, false, 'This change conflicts with selected options.', { affected, proposedState });
  }
  function clearFacet(model, state, facetId) {
    if (!FACETS.includes(facetId)) return result(state, false, 'Unknown facet.');
    const filters = { ...state.filters };
    delete filters[facetId];
    // Clearing broadens candidates and retains a compatible image identity.
    // It also keeps a disappeared explicit identity visible until the user
    // makes a replacement choice, rather than hiding the unavailable message.
    const next = { ...state, filters, facetOrder: state.facetOrder.filter(key => key !== facetId) };
    next.unavailable = unavailable(model, next);
    return result(next);
  }
  function selectLeaf(model, state, id) {
    const leaf = model.leaves.find(item => item.id === id);
    if (!leaf) return result(state, false, 'This image is no longer available in this catalog.');
    if (!leaf.selectable) return result(state, false, leaf.unavailableReason || 'This image cannot be selected.');
    if (!matches(leaf, state.filters)) return result(state, false, 'This image does not match the selected options.');
    return result({ ...state, selectedLeafId: id, origin: 'explicit', unavailable: null });
  }
  function changePath(model, state, pathId) {
    if (!model.paths.some(path => path.id === pathId)) return result(state, false, 'Unknown selection path.');
    return result({ ...state, pathId });
  }
  function resolveSelection(model, state) {
    if (unavailable(model, state)) return null;
    return model.leaves.find(leaf => leaf.id === state.selectedLeafId) || null;
  }
  function refreshState(model, state) {
    // Never silently replace an explicit missing image or erase its filters.
    const next = { ...state, pathId: model.paths.some(path => path.id === state.pathId) ? state.pathId : model.defaultPath };
    next.unavailable = unavailable(model, next);
    return freeze(next);
  }

  const api = Object.freeze({
    FACETS, PLATFORMS, validate, createModel, candidates, facetOptions, initialState,
    chooseFacet, clearFacet, selectLeaf, changePath, resolveSelection, refreshState,
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TboxGuidedCatalog = api;
})(globalThis);
