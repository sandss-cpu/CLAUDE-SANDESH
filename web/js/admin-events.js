/* ===========================================================================
   Events: what is on in Nepal's towns and cities, for the website's Events page.

   A classic script loaded after admin.js and admin-programming.js, sharing their
   globals (state, api, esc, notify, askDialog, renderMain, uploadImages, SCREENS,
   SECTIONS, CLOSERS, Actions, toNptInput, fromNptInput). Times are entered and shown
   in Kathmandu time. Editors and admins see this screen.
   =========================================================================== */

state.events = { when: 'upcoming', status: '', items: [], cities: [], editing: null };

const EVENT_KINDS = {
  FESTIVAL: 'Festival', MUSIC: 'Music', FOOD: 'Food', CULTURE: 'Culture', SPORT: 'Sport', OUTDOORS: 'Outdoors',
  MARKET: 'Market', EXHIBITION: 'Exhibition', OTHER: 'Other',
};
const EVENT_STATUS = { DRAFT: ['Draft', 'DRAFT'], PUBLISHED: ['Published', 'PUBLISHED'], CANCELLED: ['Cancelled', 'REJECTED'] };
const siteBase = () => (window.BATO_CONFIG?.site || '').replace(/\/$/, '');

/** "Sat 10 Oct 2026 · 24 Asoj 2083", in Kathmandu. */
function eventDay(iso){
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  const bs = window.BsDate?.formatBs?.(toNptInput(iso).slice(0, 10));
  return bs ? `${day} · ${bs}` : day;
}
const eventTime = (iso) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
function eventWhenText(e){
  const multi = e.endsAt && toNptInput(e.endsAt).slice(0, 10) !== toNptInput(e.startsAt).slice(0, 10);
  if(multi) return `${eventDay(e.startsAt)} – ${eventDay(e.endsAt)}`;
  return `${eventDay(e.startsAt)}${e.allDay ? ' · all day' : ` · ${eventTime(e.startsAt)}${e.endsAt ? `–${eventTime(e.endsAt)}` : ''}`}`;
}

async function screenEvents(){
  const ev = state.events;
  await loadReferenceData();
  const q = new URLSearchParams({ when: ev.when, ...(ev.status ? { status: ev.status } : {}) });
  const data = await api(`/events/admin?${q}`);
  ev.items = data.items; ev.cities = data.cities;
  return `
    <div class="top-row"><h2>Events</h2>
      <div class="row-actions">
        ${siteBase() ? `<a class="btn btn-sm" href="${esc(siteBase())}/events" target="_blank" rel="noopener">Events page ↗</a>` : ''}
        <button class="btn btn-primary" data-action="evNew">+ New event</button>
      </div>
    </div>
    <p class="hint" style="margin:-8px 0 14px">What is on in Nepal's towns and cities, on the website's Events page. Published events
      show there within minutes; a cancelled one stays listed, marked cancelled. All times are Kathmandu time.</p>
    <div class="filters">
      <label class="sr-only" for="ev-when">Which events</label>
      <select id="ev-when" data-change="evFilter" data-field="when">
        ${[['upcoming', 'Coming up and on now'], ['past', 'Finished'], ['all', 'All']].map(([v, l]) => `<option value="${v}" ${ev.when === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label class="sr-only" for="ev-status">Status</label>
      <select id="ev-status" data-change="evFilter" data-field="status">
        <option value="">Any status</option>
        ${Object.entries(EVENT_STATUS).map(([v, [l]]) => `<option value="${v}" ${ev.status === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>
    ${!ev.items.length ? `<div class="empty">No events here yet. Add one with “+ New event”.</div>` : `
    <div class="table-wrap"><table>
      <thead><tr><th>When</th><th>Event</th><th>Kind</th><th>Status</th><th></th></tr></thead>
      <tbody>${ev.items.map((e) => `
        <tr>
          <td>${esc(eventWhenText(e))}</td>
          <td><strong>${esc(e.title)}</strong>${e.isFeatured ? ' <span class="pill">Featured</span>' : ''}
            <div class="hint">${esc([e.venue, e.city].filter(Boolean).join(', '))}</div></td>
          <td>${esc(EVENT_KINDS[e.category] || e.category)}</td>
          <td><span class="pill ${EVENT_STATUS[e.status][1]}">${EVENT_STATUS[e.status][0]}</span></td>
          <td><div class="row-actions">
            <button class="btn btn-sm" data-action="evEdit" data-id="${esc(e.id)}">Edit</button>
            ${e.status === 'DRAFT' ? `<button class="btn btn-sm btn-primary" data-action="evStatus" data-id="${esc(e.id)}" data-status="PUBLISHED">Publish</button>` : ''}
            ${e.status === 'PUBLISHED' ? `<button class="btn btn-sm" data-action="evStatus" data-id="${esc(e.id)}" data-status="CANCELLED">Cancel event</button>` : ''}
            ${e.status !== 'DRAFT' && siteBase() ? `<a class="btn btn-sm btn-ghost" href="${esc(siteBase())}/events/${esc(e.slug)}" target="_blank" rel="noopener">View ↗</a>` : ''}
            <button class="btn btn-sm btn-danger" data-action="evDelete" data-id="${esc(e.id)}">Delete</button>
          </div></td>
        </tr>`).join('')}</tbody>
    </table></div>`}
    ${ev.editing ? eventForm(ev.editing) : ''}`;
}

function eventForm(e){
  const isNew = !e.id;
  const allDay = !!e.allDay;
  const when = (iso) => (iso ? (allDay ? toNptInput(iso).slice(0, 10) : toNptInput(iso)) : '');
  const places = state.destinations || [];
  return `
    <div class="modal-back" data-action="backdrop" data-closer="evCloseForm">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="ev-form-title">
        <h2 id="ev-form-title">${isNew ? 'New event' : `Edit · ${esc(e.title)}`}</h2>
        <form data-submit="evSave" data-id="${esc(e.id || '')}" novalidate>
          <label for="ev-title">Name</label>
          <input id="ev-title" name="title" required minlength="3" maxlength="120" value="${esc(e.title || '')}" placeholder="Pokhara Street Festival">
          <label for="ev-title-ne">Name in Nepali <small>(optional)</small></label>
          <input id="ev-title-ne" name="titleNe" lang="ne" maxlength="120" value="${esc(e.titleNe || '')}">
          <label for="ev-summary">One-line summary</label>
          <input id="ev-summary" name="summary" required minlength="10" maxlength="200" value="${esc(e.summary || '')}" placeholder="Five days of food stalls, music and dance along Lakeside.">
          <div class="two-col">
            <div><label for="ev-kind">Kind</label>
              <select id="ev-kind" name="category">${Object.entries(EVENT_KINDS).map(([k, l]) => `<option value="${k}" ${(e.category || 'FESTIVAL') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div><label for="ev-city">Town or city</label>
              <input id="ev-city" name="city" required maxlength="60" list="ev-cities" value="${esc(e.city || '')}" placeholder="Pokhara">
              <datalist id="ev-cities">${[...new Set([...state.events.cities, ...places.map((p) => p.name)])].map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist></div>
          </div>
          <div class="two-col">
            <div><label for="ev-venue">Venue <small>(optional)</small></label><input id="ev-venue" name="venue" maxlength="120" value="${esc(e.venue || '')}" placeholder="Lakeside"></div>
            <div><label for="ev-address">Address <small>(optional)</small></label><input id="ev-address" name="address" maxlength="200" value="${esc(e.address || '')}"></div>
          </div>
          <label for="ev-place">Place page on the website <small>(optional)</small></label>
          <select id="ev-place" name="destinationId"><option value="">None</option>${places.map((p) => `<option value="${esc(p.id)}" ${e.destinationId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          <label class="check"><input type="checkbox" name="allDay" data-change="evAllDay" ${allDay ? 'checked' : ''}> All day (no set times)</label>
          <div class="two-col">
            <div><label for="ev-start">Starts (Kathmandu time)</label><input id="ev-start" name="startsAt" required type="${allDay ? 'date' : 'datetime-local'}" value="${esc(when(e.startsAt))}"></div>
            <div><label for="ev-end">Ends <small>(optional)</small></label><input id="ev-end" name="endsAt" type="${allDay ? 'date' : 'datetime-local'}" value="${esc(when(e.endsAt))}"></div>
          </div>
          <div class="two-col">
            <div><label for="ev-price">Price <small>(optional)</small></label><input id="ev-price" name="priceLabel" maxlength="40" value="${esc(e.priceLabel || '')}" placeholder="Free, or Rs 500"></div>
            <div><label for="ev-org">Organised by <small>(optional)</small></label><input id="ev-org" name="organiser" maxlength="120" value="${esc(e.organiser || '')}"></div>
          </div>
          <label for="ev-url">Tickets or details link <small>(optional)</small></label>
          <input id="ev-url" name="url" type="url" maxlength="500" value="${esc(e.url || '')}" placeholder="https://">
          <label>Picture <small>(optional)</small></label>
          <input type="hidden" id="ev-image" name="imageUrl" value="${esc(e.imageUrl || '')}">
          <div class="row-actions">
            <div id="ev-image-preview" class="thumb">${e.imageUrl ? `<img src="${esc(e.imageUrl)}" alt="">` : '<span class="hint">No picture</span>'}</div>
            <input type="file" accept="image/*" data-change="evUploadImage" aria-label="Upload a picture">
            ${e.imageUrl ? '<button type="button" class="btn btn-sm btn-ghost" data-action="evClearImage">Remove picture</button>' : ''}
          </div>
          <p class="hint" id="ev-image-status"></p>
          <label for="ev-desc">More about it <small>(optional; ## for headings, a blank line between paragraphs)</small></label>
          <textarea id="ev-desc" name="description" class="short" rows="6" maxlength="8000">${esc(e.description || '')}</textarea>
          <div class="two-col">
            <div><label for="ev-status-field">Status</label>
              <select id="ev-status-field" name="status">${Object.entries(EVENT_STATUS).map(([k, [l]]) => `<option value="${k}" ${(e.status || 'DRAFT') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
            <div><label class="check" style="margin-top:28px"><input type="checkbox" name="isFeatured" ${e.isFeatured ? 'checked' : ''}> Featured</label></div>
          </div>
          <div class="error" id="ev-error" role="alert" hidden></div>
          <div class="row-actions" style="justify-content:flex-end;margin-top:14px">
            <button type="button" class="btn btn-ghost" data-action="evCloseForm">Cancel</button>
            <button class="btn btn-primary">${isNew ? 'Add event' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>`;
}

function evCloseForm(){ state.events.editing = null; renderMain(); }
CLOSERS.evCloseForm = evCloseForm;

function evFormError(message){
  const box = document.getElementById('ev-error');
  if(box){ box.textContent = message; box.hidden = false; box.scrollIntoView({ block: 'nearest' }); }
}

/** The whole form, as the API takes it: Kathmandu times become UTC instants. */
function eventBody(form){
  const f = form.elements;
  const allDay = f.allDay.checked;
  const at = (v) => (!v ? null : fromNptInput(allDay ? `${v}T00:00` : v));
  return {
    title: f.title.value, titleNe: f.titleNe.value, summary: f.summary.value, category: f.category.value,
    city: f.city.value, venue: f.venue.value, address: f.address.value, destinationId: f.destinationId.value || null,
    allDay, startsAt: at(f.startsAt.value), endsAt: at(f.endsAt.value),
    priceLabel: f.priceLabel.value, organiser: f.organiser.value, url: f.url.value, imageUrl: f.imageUrl.value || null,
    description: f.description.value, status: f.status.value, isFeatured: f.isFeatured.checked,
  };
}

async function evRun(work, success){
  try{ await work(); if(success) notify(success); }catch(err){ notify(err.message, 'error'); }
  await renderMain();
}

Actions.on({
  evNew: () => { state.events.editing = { status: 'DRAFT', category: 'FESTIVAL' }; renderMain(); },
  evEdit: async (el) => {
    try{ state.events.editing = await api(`/events/admin/${el.dataset.id}`); renderMain(); }catch(err){ notify(err.message, 'error'); }
  },
  evCloseForm: () => evCloseForm(),
  evClearImage: () => {
    $('#ev-image').value = '';
    $('#ev-image-preview').innerHTML = '<span class="hint">No picture</span>';
  },
  evStatus: async (el) => {
    const e = state.events.items.find((x) => x.id === el.dataset.id);
    const next = el.dataset.status;
    if(next === 'CANCELLED'){
      const ok = await askDialog({ title: 'Cancel this event?', message: `“${e?.title}” stays on the Events page, marked cancelled, so people who planned to go find out.`, confirmLabel: 'Cancel event', danger: true });
      if(!ok) return;
    }
    const full = await api(`/events/admin/${el.dataset.id}`);
    evRun(() => api(`/events/${el.dataset.id}`, { method: 'PATCH', body: { ...full, status: next } }),
      next === 'PUBLISHED' ? 'Published: it is on the Events page now.' : 'Marked cancelled.');
  },
  evDelete: async (el) => {
    const e = state.events.items.find((x) => x.id === el.dataset.id);
    const ok = await askDialog({ title: 'Delete this event?', message: `“${e?.title}” is removed from the website for good. To tell people it is off, cancel it instead.`, confirmLabel: 'Delete', danger: true });
    if(ok) evRun(() => api(`/events/${el.dataset.id}`, { method: 'DELETE' }), 'Event deleted.');
  },
});

Actions.onChange({
  evFilter: (el) => { state.events[el.dataset.field] = el.value; renderMain(); },
  // Switching to all day keeps the dates and drops the times, and back again.
  evAllDay: (el) => {
    const form = el.closest('form');
    for(const name of ['startsAt', 'endsAt']){
      const input = form.elements[name];
      const v = input.value;
      input.type = el.checked ? 'date' : 'datetime-local';
      input.value = !v ? '' : el.checked ? v.slice(0, 10) : `${v.slice(0, 10)}T${name === 'startsAt' ? '10:00' : '17:00'}`;
    }
  },
  evUploadImage: async (el) => {
    const files = [...el.files];
    el.value = '';
    if(!files.length) return;
    const status = $('#ev-image-status');
    status.textContent = 'Uploading…';
    try{
      const { files: saved } = await uploadImages(files.slice(0, 1));
      $('#ev-image').value = saved[0].url;
      $('#ev-image-preview').innerHTML = `<img src="${esc(saved[0].url)}" alt="">`;
      status.textContent = 'Uploaded. Save the event to keep it.';
    }catch(err){ status.textContent = err.message; }
  },
});

Actions.onSubmit({
  evSave: async (form, ev) => {
    ev.preventDefault();
    const body = eventBody(form);
    if(!body.title.trim() || !body.summary.trim() || !body.city.trim() || !body.startsAt){
      return evFormError('A name, a one-line summary, the town or city and when it starts are all needed.');
    }
    const id = form.dataset.id;
    try{
      await api(id ? `/events/${id}` : '/events', { method: id ? 'PATCH' : 'POST', body });
      state.events.editing = null;
      notify(id ? 'Event saved.' : body.status === 'PUBLISHED' ? 'Event added: it is on the Events page now.' : 'Event added as a draft.');
      renderMain();
    }catch(err){ evFormError(err.message); }
  },
});

SECTIONS.splice(SECTIONS.findIndex(([k]) => k === 'guides') + 1, 0, ['events', 'Events', ['EDITOR', 'ADMIN']]);
SCREENS.events = screenEvents;
