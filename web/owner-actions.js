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
  // scorecards, appraisals, leaderboard
  scorecardRange: (el) => scorecardRange(el.dataset.range),
  driverReviews: (el) => driverReviews(el.dataset.id),
  newAppraisal: (el) => newAppraisal(el.dataset.id),
  appraisalPdf: (el) => downloadFile(`/fleet/appraisals/${el.dataset.id}/pdf`),
  acknowledgeAppraisal: (el) => acknowledgeAppraisal(el.dataset.id),
  deleteAppraisal: (el) => deleteAppraisal(el.dataset.id),
  // income
  incomeRange: (el) => { state.income.range = el.dataset.range; renderApp(); },
  incomeExport: (el) => incomeExport(el.dataset.format),
  copyYesterday: (el) => copyYesterday(el),
  deleteIncome: (el) => deleteIncome(el.dataset.id),
  viewStatement: (el) => viewStatement(el.dataset.id),
  undoImport: (el) => undoImport(el.dataset.id),
  addIncomeSource: () => addIncomeSource(),
  editIncomeSource: (el) => editIncomeSource(el.dataset.id),
  enableFinance: () => enableFinance(),
  // sessions and recovery codes
  signOutEverywhere: () => signOutEverywhere(),
  downloadCodes: (el) => downloadCodes(el.dataset.codes.split(' ')),
  codesSaved: () => finishSignIn(state.login.pending),
  // verification documents
  viewDocument: (el) => viewDocument(el.dataset.id),
  deleteDocument: (el) => deleteDocument(el.dataset.id, el.dataset.label),
  disableFinance: () => disableFinance(),
});

Actions.onSubmit({
  authSignIn: (el, ev) => authSignIn(ev),
  authRegister: (el, ev) => authRegister(ev),
  authForgot: (el, ev) => authForgot(ev),
  authReset: (el, ev) => authReset(ev),
  authMfa: (el, ev) => authMfa(ev),
  authRecover: (el, ev) => authRecover(ev),
  uploadDocument: (el, ev) => uploadDocument(el, ev),
  registerCompany: (el, ev) => registerCompany(ev),
  assignCrew: (el, ev) => assignCrew(ev),
  searchBuses: (el, ev) => { ev.preventDefault(); filterBuses({ q: el.elements.q.value.trim() }); },
  scorecardCustom: (el, ev) => scorecardCustom(el, ev),
  saveAppraisal: (el, ev) => saveAppraisal(el, ev),
  authEnrol: (el, ev) => authEnrol(ev),
  saveSheet: (el, ev) => saveSheet(el, ev),
  previewImport: (el, ev) => previewImport(el, ev),
  recheckImport: (el, ev) => recheckImport(el, ev),
  openSheetDay: (el, ev) => { ev.preventDefault(); go(`sheet/${el.elements.bus.value}/${el.elements.day.value}`); },
  incomeCustom: (el, ev) => {
    ev.preventDefault();
    const from = el.elements.from.value; const to = el.elements.to.value;
    if(!from || !to || from > to){ notify('Choose a start date on or before the end date.', 'error'); return; }
    Object.assign(state.income, { range: 'custom', from, to }); renderApp();
  },
});

Actions.onChange({
  switchCompany: (el) => switchCompany(el.value),
  filterBuses: (el) => filterBuses({ [el.dataset.field]: el.type === 'checkbox' ? el.checked : el.value }),
  filterFeedback: (el) => filterFeedback({ [el.dataset.field]: el.value }),
  addSheetSource: (el) => addSheetSource(el),
  attachStatement: (el) => attachStatement(el),
  shareTotals: (el) => shareTotals(el),
  incomeOption: (el) => { state.income[el.dataset.field] = el.value; renderApp(); },
});

Actions.onInput({
  sheetTotals: (el) => sheetTotals(el),
});
