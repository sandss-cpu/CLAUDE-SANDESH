/**
 * Delegated event handling, so pages carry no inline handlers and a strict
 * Content-Security-Policy (no 'unsafe-inline' scripts) can be switched on.
 *
 * Markup names what should happen, never how:
 *
 *   <button data-action="openArticle" data-slug="...">        click
 *   <input  data-input="draftTitle">                           input
 *   <input  data-change="addPhotos" type="file">               change
 *   <form   data-submit="sendReport" data-id="...">            submit
 *   <button data-press="sos">                                  press and hold
 *
 * A page registers the names it answers to. Anything not registered is ignored
 * with a console warning, so markup — including markup built from API data —
 * can only ever call a handler the page chose to expose.
 *
 * Handlers receive (element, event). Press handlers also get a phase first:
 * 'down', 'up', 'cancel' or 'leave'.
 */
(function () {
  'use strict';

  const registry = { action: {}, input: {}, change: {}, submit: {}, press: {} };

  function register(kind, handlers) {
    if (!registry[kind]) throw new Error(`Unknown action kind "${kind}"`);
    Object.assign(registry[kind], handlers);
  }

  function find(kind, target) {
    const el = target && target.closest ? target.closest(`[data-${kind}]`) : null;
    if (!el) return null;
    const name = el.dataset[kind];
    const fn = registry[kind][name];
    if (!fn) {
      console.warn(`No ${kind} handler named "${name}"`);
      return null;
    }
    return { el, fn };
  }

  function listen(type, kind) {
    document.addEventListener(type, (ev) => {
      const hit = find(kind, ev.target);
      if (hit) hit.fn(hit.el, ev);
    });
  }

  listen('click', 'action');
  listen('input', 'input');
  listen('change', 'change');
  listen('submit', 'submit');

  // pointerleave does not bubble, so a hold is cancelled on pointerout instead,
  // ignoring moves between the button and its own children.
  const PRESS = { pointerdown: 'down', pointerup: 'up', pointercancel: 'cancel', pointerout: 'leave' };
  for (const [type, phase] of Object.entries(PRESS)) {
    document.addEventListener(type, (ev) => {
      const hit = find('press', ev.target);
      if (!hit) return;
      if (phase === 'leave' && hit.el.contains(ev.relatedTarget)) return;
      hit.fn(phase, hit.el, ev);
    });
  }

  // A long press opens the context menu on phones, which would end every hold early.
  document.addEventListener('contextmenu', (ev) => {
    if (ev.target.closest && ev.target.closest('[data-press]')) ev.preventDefault();
  });

  window.Actions = {
    on: (handlers) => register('action', handlers),
    onInput: (handlers) => register('input', handlers),
    onChange: (handlers) => register('change', handlers),
    onSubmit: (handlers) => register('submit', handlers),
    onPress: (handlers) => register('press', handlers),
  };
})();
