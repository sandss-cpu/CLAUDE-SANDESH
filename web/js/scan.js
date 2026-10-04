/* Scanning a bus's QR from inside Batoma, for someone already in the app who has boarded
   another bus. BarcodeDetector where the browser has it; elsewhere (Safari, mostly) the
   vendored jsQR decoder, loaded only then.

   Whatever the code says, the page only ever goes to this site's own /b/<code>: a QR is
   untrusted input, and following any URL in it would make this a redirect for anyone's
   sticker. */
(function () {
  'use strict';

  const CODE_RE = /^[A-Z0-9]{4,16}$/;
  const $ = (s) => document.querySelector(s);
  let stream = null;
  let running = false;

  function status(text, bad) {
    const el = $('#status');
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
  }

  /** A Batoma code from what a QR holds: a /b/ or /r/ link, an old ?c= or ?code= one, or a bare code. */
  function codeFrom(text) {
    const raw = String(text || '').trim();
    let candidate = '';
    try {
      const url = new URL(raw);
      const path = url.pathname.match(/^\/(?:b|r)\/([^/]+)\/?$/);
      candidate = path ? decodeURIComponent(path[1]) : (url.searchParams.get('c') || url.searchParams.get('code') || '');
    } catch (_) {
      candidate = raw;
    }
    candidate = candidate.trim().toUpperCase();
    return CODE_RE.test(candidate) ? candidate : null;
  }

  function open(code) {
    stop();
    status('Opening the magazine for this bus…');
    location.assign(`/b/${encodeURIComponent(code)}`);
  }

  function stop() {
    running = false;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  function loadJsQr() {
    return new Promise((resolve, reject) => {
      if (window.jsQR) return resolve(window.jsQR);
      const s = document.createElement('script');
      s.src = '/vendor/jsqr.js';
      s.onload = () => (window.jsQR ? resolve(window.jsQR) : reject(new Error('decoder missing')));
      s.onerror = () => reject(new Error('decoder failed to load'));
      document.head.appendChild(s);
    });
  }

  async function makeDetector() {
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          return async (video) => (await detector.detect(video))[0]?.rawValue || null;
        }
      } catch (_) { /* fall through to jsQR */ }
    }
    const jsQR = await loadJsQr();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return async (video) => {
      const w = video.videoWidth; const h = video.videoHeight;
      if (!w || !h) return null;
      // A smaller frame decodes faster and a QR on a seat back is still plenty large.
      const scale = Math.min(1, 640 / Math.max(w, h));
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data || null;
    };
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      status('This browser cannot use the camera. Type the code printed under the QR instead.', true);
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (err) {
      status(err?.name === 'NotAllowedError'
        ? 'Camera permission was refused. Allow it in your browser settings, or type the code instead.'
        : 'The camera could not start. Type the code printed under the QR instead.', true);
      return;
    }
    const video = $('#video');
    video.srcObject = stream;
    video.hidden = false; $('#frame').hidden = false; $('#idle').hidden = true;
    await video.play().catch(() => {});
    status('Looking for a code…');
    let detect;
    try { detect = await makeDetector(); } catch (_) {
      status('Scanning is not available here. Type the code printed under the QR instead.', true);
      stop();
      return;
    }
    running = true;
    let lastWarning = '';
    const tick = async () => {
      if (!running) return;
      try {
        const text = await detect(video);
        if (text) {
          const code = codeFrom(text);
          if (code) return open(code);
          if (text !== lastWarning) { lastWarning = text; status('That QR code is not a Batoma bus code.', true); }
        }
      } catch (_) { /* a frame that would not decode; try the next */ }
      setTimeout(tick, 180);
    };
    tick();
  }

  Actions.on({ startCamera: () => start() });
  Actions.onSubmit({
    openCode: (form, ev) => {
      ev.preventDefault();
      const code = codeFrom(form.elements.code.value);
      if (code) open(code); else status('That does not look like a bus code. It has 4 to 16 letters and numbers.', true);
    },
  });

  // Leaving the page, or hiding it, lets go of the camera at once.
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
})();
