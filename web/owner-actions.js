/* What the owner portal's markup may ask for (see js/actions.js). Loaded last, after the
   other owner-*.js scripts, whose functions these call. */

const pageOf = (el) => Number(el.dataset.page);

Actions.on({
  // shell and sign-in
  go: (el) => go(el.dataset.to),
  // A real link inside a clickable row: let it do its own thing, and stop the row.
  follow: () => {},
  authGo: (el) => authGo(el.dataset.step),
  authResend: () => authResend(),
  bootApp: () => bootApp(),
  renderApp: () => renderApp(),
  signOut: (el, ev) => { ev.preventDefault(); signOut(); },
  toggleTheme: () => toggleTheme(),
  selectFirstCompany: () => selectCompany(state.companies[0].id),
  // dashboard, buses, reminders, reviews
  newBus: () => newBus(),
  markAllRead: () => markAllRead(),
  replyReview: (el) => replyReview(el.dataset.id),
  reportReview: (el) => reportReview(el.dataset.id),
  busesPage: (el) => filterBuses({ page: pageOf(el) }, true),
  feedbackPage: (el) => filterFeedback({ page: pageOf(el) }, true),
  busReviewsPage: (el) => { state.busReviewsPage = pageOf(el); renderApp(); },
  // one bus
  editBus: () => editBus(),
  deleteBus: () => deleteBus(),
  archiveBus: (el) => archiveBus(el.dataset.archived === 'true'),
  exportCsv: (el) => exportCsv(el.dataset.id),
  printReport: (el) => printReport(el.dataset.id),
  addService: () => addService(),
  editService: (el) => editService(el.dataset.id),
  deleteService: (el) => deleteService(el.dataset.id),
  reportIncident: () => reportIncident(),
  resolveIncident: (el) => resolveIncident(el.dataset.id),
  addDocument: () => addDocument(),
  editDocument: (el) => editDocument(el.dataset.id),
  deleteDocument: (el) => deleteDocument(el.dataset.id),
  unassignCrew: (el) => unassignCrew(el.dataset.id),
  addFuel: () => addFuel(),
  deleteFuel: (el) => deleteFuel(el.dataset.id),
  printSticker: () => printSticker(),
  downloadSvg: () => downloadSvg(),
  copyLink: () => copyLink(),
  rotateBusQr: () => rotateBusQr(),
  stickerDownload: (el) => stickerDownload(el.dataset.format, el.dataset.size),
  fleetStickers: () => fleetStickers(),
  // crew and company
  addDriver: () => addDriver(),
  editDriver: (el) => editDriver(el.dataset.id),
  editCompany: () => editCompany(),
  addMember: () => addMember(),
  removeMember: (el) => removeMember(el.dataset.id),
  rotateCompanyQr: () => rotateCompanyQr(),
});

Actions.onSubmit({
  authSignIn: (el, ev) => authSignIn(ev),
  authRegister: (el, ev) => authRegister(ev),
  authForgot: (el, ev) => authForgot(ev),
  authReset: (el, ev) => authReset(ev),
  authMfa: (el, ev) => authMfa(ev),
  registerCompany: (el, ev) => registerCompany(ev),
  assignCrew: (el, ev) => assignCrew(ev),
  searchBuses: (el, ev) => { ev.preventDefault(); filterBuses({ q: el.elements.q.value.trim() }); },
});

Actions.onChange({
  switchCompany: (el) => switchCompany(el.value),
  filterBuses: (el) => filterBuses({ [el.dataset.field]: el.type === 'checkbox' ? el.checked : el.value }),
  filterFeedback: (el) => filterFeedback({ [el.dataset.field]: el.value }),
});
