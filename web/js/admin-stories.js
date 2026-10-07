/* ===========================================================================
   Story submissions: stories readers sent from the website's "Write a trip" page.

   A classic script loaded after admin.js, sharing its globals (state, api, esc, notify,
   askDialog, renderMain, loadReferenceData, editArticle, SCREENS, SECTIONS, CLOSERS,
   Actions). Only stories whose writers confirmed their email are here. Featuring one
   makes a magazine draft with the writer's byline and opens it in the article editor.
   =========================================================================== */

state.stories = { status: 'SUBMITTED', items: [], counts: {}, reading: null };

const STORY_TABS = [['SUBMITTED', 'Waiting'], ['FEATURED', 'Featured'], ['DECLINED', 'Declined']];
const storyDay = (iso) => (iso ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso)) : '');

async function screenStories(){
  const s = state.stories;
  const data = await api(`/stories/admin?status=${s.status}`);
  s.items = data.items; s.counts = data.counts;
  return `
    <div class="top-row"><h2>Story submissions</h2></div>
    <p class="hint" style="margin:-8px 0 14px">Stories readers sent from the website's “Write a trip” page. Each writer has
      confirmed their email. <strong>Feature in magazine</strong> turns a story into a draft article with the writer's name on it,
      for you to edit and publish; <strong>Decline</strong> lets the writer know kindly. Either way, they get an email.</p>
    <div class="login-tabs" role="tablist" aria-label="Which stories">
      ${STORY_TABS.map(([k, label]) => `<button role="tab" aria-selected="${s.status === k}" class="${s.status === k ? 'active' : ''}"
        data-action="storyTab" data-status="${k}">${label}${s.counts[k] ? ` (${s.counts[k]})` : ''}</button>`).join('')}
    </div>
    ${!s.items.length ? `<div class="empty" style="margin-top:14px">${s.status === 'SUBMITTED' ? 'No stories waiting. New ones arrive here once their writers confirm their email.' : 'None yet.'}</div>`
      : `<div style="margin-top:14px">${s.items.map(storyCard).join('')}</div>`}
    ${s.reading ? storyReader(s.reading) : ''}`;
}

function storyCard(x){
  return `
    <article class="sub-card">
      <h3>${esc(x.title)}</h3>
      <div class="hint">${esc(x.user.name)} · ${esc(x.user.email || '')}${x.place ? ` · ${esc(x.place)}` : ''} · ${x.words} words
        · sent ${esc(storyDay(x.submittedAt))}${x.decidedAt ? ` · decided ${esc(storyDay(x.decidedAt))}` : ''}</div>
      ${x.opening ? `<p style="margin:8px 0">${esc(x.opening)}</p>` : ''}
      ${x.status === 'DECLINED' && x.editorNote ? `<p class="hint">Note sent: ${esc(x.editorNote)}</p>` : ''}
      <div class="row-actions">
        <button class="btn btn-sm" data-action="storyRead" data-id="${esc(x.id)}">Read</button>
        ${x.status === 'SUBMITTED' ? `
          <button class="btn btn-sm btn-primary" data-action="storyFeature" data-id="${esc(x.id)}">Feature in magazine</button>
          <button class="btn btn-sm btn-danger" data-action="storyDecline" data-id="${esc(x.id)}">Decline</button>` : ''}
        ${x.article ? `<button class="btn btn-sm" data-action="storyOpenArticle" data-id="${esc(x.article.id)}">Open the article</button>
          <span class="pill ${esc(x.article.status)}">${esc(x.article.status.toLowerCase())}</span>` : ''}
      </div>
    </article>`;
}

function storyReader(x){
  return `
    <div class="modal-back" data-action="backdrop" data-closer="storyCloseReader">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="story-title" style="max-width:760px">
        <h2 id="story-title">${esc(x.title)}</h2>
        <p class="hint">${esc(x.user.name)} · ${esc(x.user.email || '')}${x.place ? ` · ${esc(x.place)}` : ''} · ${x.words} words · sent ${esc(storyDay(x.submittedAt))}</p>
        <div class="story-read">${esc(x.body)}</div>
        <div class="row-actions" style="justify-content:flex-end;margin-top:14px">
          <button type="button" class="btn btn-ghost" data-action="storyCloseReader">Close</button>
          ${x.status === 'SUBMITTED' ? `
            <button class="btn btn-danger" data-action="storyDecline" data-id="${esc(x.id)}">Decline</button>
            <button class="btn btn-primary" data-action="storyFeature" data-id="${esc(x.id)}">Feature in magazine</button>` : ''}
        </div>
      </div>
    </div>`;
}

function storyCloseReader(){ state.stories.reading = null; renderMain(); }
CLOSERS.storyCloseReader = storyCloseReader;

/** The article editor lives on the Articles screen, so go there to open it. */
async function storyOpenArticle(id){
  state.stories.reading = null;
  state.screen = 'articles';
  renderSidebar();
  try{ await loadReferenceData(); await editArticle(id); }
  catch(err){ notify(err.message, 'error'); renderMain(); }
}

Actions.on({
  storyTab: (el) => { Object.assign(state.stories, { status: el.dataset.status, reading: null }); renderMain(); },
  storyRead: async (el) => {
    try{ state.stories.reading = await api(`/stories/admin/${el.dataset.id}`); renderMain(); }catch(err){ notify(err.message, 'error'); }
  },
  storyCloseReader: () => storyCloseReader(),
  storyOpenArticle: (el) => storyOpenArticle(el.dataset.id),
  storyFeature: async (el) => {
    await loadReferenceData();
    const section = await askDialog({
      title: 'Feature this story in the magazine?',
      message: 'It becomes a draft article with the writer’s name on it, and opens in the editor. Add a summary, key points and pictures, then publish it as usual. The writer gets an email.',
      confirmLabel: 'Make the draft',
      field: { type: 'select', label: 'Section', value: '', options: [['', 'Choose later'], ...(state.categories || []).map((c) => [c.id, c.name])] },
    });
    if(section === null) return;
    try{
      const r = await api(`/stories/admin/${el.dataset.id}/feature`, { method: 'POST', body: { categoryId: section || undefined } });
      notify('Draft made. Finish it in the editor, then publish.');
      await storyOpenArticle(r.articleId);
    }catch(err){ notify(err.message, 'error'); renderMain(); }
  },
  storyDecline: async (el) => {
    const note = await askDialog({
      title: 'Decline this story?',
      message: 'The writer gets a kind email saying we cannot publish it this time. Add a note if it would help them.',
      confirmLabel: 'Decline', danger: true,
      field: { type: 'textarea', label: 'Note to the writer (optional)', placeholder: 'For example: we covered Bandipur recently; we would love something on the road beyond it.' },
    });
    if(note === null) return;
    try{
      await api(`/stories/admin/${el.dataset.id}/decline`, { method: 'POST', body: { note: note || undefined } });
      state.stories.reading = null;
      notify('Declined. The writer has been told.');
    }catch(err){ notify(err.message, 'error'); }
    renderMain();
  },
});

SECTIONS.splice(SECTIONS.findIndex(([k]) => k === 'articles') + 1, 0, ['stories', 'Story submissions', ['EDITOR', 'ADMIN']]);
SCREENS.stories = screenStories;
