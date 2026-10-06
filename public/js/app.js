(() => {
  'use strict';

  // The sidebar/topbar/player are mounted ONCE. Only <main> is replaced when
  // navigating between EJS pages; the audio element keeps its source and time.
  let pendingNavigation = null;
  let navigationSerial = 0;
  const audio = document.querySelector('#audio-player');
  const playBtn = document.querySelector('#player-toggle');
  const title = document.querySelector('#player-title');
  const artist = document.querySelector('#player-artist');
  const cover = document.querySelector('#player-cover');
  const currentTime = document.querySelector('#current-time');
  const totalTime = document.querySelector('#total-time');
  const seek = document.querySelector('#player-seek');
  const volume = document.querySelector('#player-volume');
  const dialog = document.querySelector('#vip-dialog');
  let queue = [];
  let playingIndex = -1;

  const time = seconds => !Number.isFinite(seconds) ? '0:00' :
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

  function openVIP() { if (dialog) dialog.hidden = false; }

  function readTrack(button) {
    return {
      id: button.dataset.play,
      title: button.dataset.title || 'Bài hát',
      artist: button.dataset.artist || 'WAVE Music',
      cover: button.dataset.cover || '',
      vip: button.dataset.vip || 'FREE'
    };
  }

  function tracksOnPage() {
    const seen = new Set();
    return [...document.querySelectorAll('.play-trigger[data-play]')]
      .map(readTrack).filter(track => {
        if (!track.id || seen.has(track.id)) return false;
        seen.add(track.id);
        return true;
      });
  }

  function playTrack(track) {
    if (!audio || !playBtn || !track) return;
    // This is a UX check only; the /stream endpoint ALSO enforces VIP on server.
    if (track.vip === 'VIP' && document.body.dataset.vip !== 'true') {
      openVIP();
      return;
    }
    playingIndex = queue.findIndex(item => item.id === track.id);
    title.textContent = track.title;
    artist.textContent = track.artist;
    cover.replaceChildren();
    if (track.cover) {
      const image = document.createElement('img');
      image.src = track.cover;
      image.alt = '';
      cover.append(image);
    } else cover.textContent = '♫';
    currentTime.textContent = '0:00';
    totalTime.textContent = '0:00';
    seek.value = '0';
    audio.src = `/songs/${encodeURIComponent(track.id)}/stream`;
    audio.play().catch(() => { playBtn.textContent = '▶'; });
  }

  function playFromButton(button) {
    const chosen = readTrack(button);
    // Keep the old queue when browsing to another page. Clicking a new song
    // creates a fresh queue from the currently displayed library/playlist.
    queue = tracksOnPage();
    if (!queue.some(item => item.id === chosen.id)) queue.push(chosen);
    playTrack(chosen);
  }

  if (audio && playBtn) {
    playBtn.addEventListener('click', () => {
      if (!audio.getAttribute('src')) {
        const first = document.querySelector('.play-trigger[data-play]');
        if (first) playFromButton(first);
        return;
      }
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    });
    document.querySelector('#player-prev')?.addEventListener('click', () => {
      if (!queue.length) return;
      playTrack(queue[(playingIndex - 1 + queue.length) % queue.length]);
    });
    document.querySelector('#player-next')?.addEventListener('click', () => {
      if (!queue.length) return;
      playTrack(queue[(playingIndex + 1) % queue.length]);
    });
    audio.addEventListener('play', () => { playBtn.textContent = '❚❚'; });
    audio.addEventListener('pause', () => { playBtn.textContent = '▶'; });
    audio.addEventListener('ended', () => { playBtn.textContent = '▶'; });
    audio.addEventListener('error', () => {
      if (!audio.currentSrc) return;
      playBtn.textContent = '▶';
      if (audio.error) alert('Không thể phát bài hát. Kiểm tra quyền VIP hoặc tệp âm thanh trên server.');
    });
    audio.addEventListener('timeupdate', () => {
      currentTime.textContent = time(audio.currentTime);
      if (Number.isFinite(audio.duration) && audio.duration > 0)
        seek.value = String(Math.round(audio.currentTime / audio.duration * 100));
    });
    audio.addEventListener('loadedmetadata', () => { totalTime.textContent = time(audio.duration); });
    seek?.addEventListener('input', () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0)
        audio.currentTime = Number(seek.value) / 100 * audio.duration;
    });
    if (volume) {
      audio.volume = Number(volume.value) / 100;
      volume.addEventListener('input', () => { audio.volume = Number(volume.value) / 100; });
    }
  }

  function isSameShell(nextDocument) {
    const nextBody = nextDocument.body;
    const nextMain = nextDocument.querySelector('main.page-content');
    return !!(nextBody && nextMain && nextDocument.querySelector('#audio-player') &&
      nextBody.classList.contains('admin-shell') === document.body.classList.contains('admin-shell') &&
      nextBody.dataset.loggedIn === document.body.dataset.loggedIn);
  }

  function updateNavigation(nextDocument) {
    const nextLinks = [...nextDocument.querySelectorAll('.sidebar .nav-link')];
    for (const link of document.querySelectorAll('.sidebar .nav-link')) {
      const replacement = nextLinks.find(item => item.getAttribute('href') === link.getAttribute('href'));
      if (replacement) link.classList.toggle('selected', replacement.classList.contains('selected'));
    }
    const label = nextDocument.querySelector('.topbar-label');
    if (label && document.querySelector('.topbar-label'))
      document.querySelector('.topbar-label').textContent = label.textContent;
    const csrf = nextDocument.querySelector('meta[name="csrf-token"]');
    if (csrf && document.querySelector('meta[name="csrf-token"]'))
      document.querySelector('meta[name="csrf-token"]').content = csrf.content;
    document.body.dataset.vip = nextDocument.body.dataset.vip;
    document.title = nextDocument.title;
    dialog && (dialog.hidden = true);
    document.querySelector('#sidebar')?.classList.remove('open');
  }

  function scrollAfterNavigation(target) {
    const id = target.hash ? decodeURIComponent(target.hash.substring(1)) : '';
    const anchor = id && document.getElementById(id);
    if (anchor) anchor.scrollIntoView();
    else window.scrollTo(0, 0);
  }

  async function navigate(address, pushHistory = true) {
    const target = new URL(address, location.href);
    if (target.origin !== location.origin || !['http:', 'https:'].includes(target.protocol)) {
      location.assign(target.href);
      return;
    }
    pendingNavigation?.abort();
    const controller = new AbortController();
    pendingNavigation = controller;
    const serial = ++navigationSerial;
    document.querySelector('main.page-content')?.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(target.href, {
        method:'GET', credentials:'same-origin', signal:controller.signal,
        headers:{Accept:'text/html'}
      });
      if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html'))
        throw new Error(`Navigation failed (${response.status})`);
      const nextDocument = new DOMParser().parseFromString(await response.text(), 'text/html');
      if (serial !== navigationSerial) return;
      // Login/logout or a changed user role needs a full reload of the shell.
      if (!isSameShell(nextDocument)) {
        location.assign(response.url || target.href);
        return;
      }
      const final = new URL(response.url || target.href);
      if (final.pathname === target.pathname && final.search === target.search)
        final.hash = target.hash;
      if (pushHistory) history.pushState({}, '', final.href);
      const main = document.querySelector('main.page-content');
      const replacement = nextDocument.querySelector('main.page-content');
      main.replaceChildren(...Array.from(replacement.childNodes));
      updateNavigation(nextDocument);
      document.dispatchEvent(new CustomEvent('wave:navigation'));
      scrollAfterNavigation(final);
    } catch (error) {
      if (error.name === 'AbortError' || serial !== navigationSerial) return;
      console.error('Không thể chuyển trang không tải lại:', error);
      // Progressive enhancement: normal navigation continues to work if fetch fails.
      location.assign(target.href);
    } finally {
      if (serial === navigationSerial) {
        document.querySelector('main.page-content')?.removeAttribute('aria-busy');
        pendingNavigation = null;
      }
    }
  }

  // Delegation works for buttons/forms/links added after replacing <main>.
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('#menu-toggle')) {
      document.querySelector('#sidebar')?.classList.toggle('open');
      return;
    }
    if (event.target.closest('#dialog-close')) { if (dialog) dialog.hidden = true; return; }
    if (event.target === dialog) { dialog.hidden = true; return; }
    const trigger = event.target.closest('.play-trigger[data-play]');
    if (trigger) { event.preventDefault(); playFromButton(trigger); return; }
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey ||
        event.shiftKey || event.altKey || link.target && link.target !== '_self' ||
        link.hasAttribute('download') || link.hasAttribute('data-full-reload')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) return;
    // Let in-page anchors use native browser scrolling without an extra fetch.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    event.preventDefault();
    navigate(url.href);
  });

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
      event.preventDefault(); return;
    }
    if (event.defaultPrevented || form.method.toLowerCase() !== 'get' || form.hasAttribute('data-full-reload')) return;
    const action = new URL(form.action || location.href, location.href);
    if (action.origin !== location.origin) return;
    const params = new URLSearchParams(new FormData(form));
    if (event.submitter?.name) params.append(event.submitter.name, event.submitter.value);
    action.search = params.toString();
    event.preventDefault();
    navigate(action.href);
  });

  window.addEventListener('popstate', () => { navigate(location.href, false); });


  function bindPaymentDemo() {
    const page = document.querySelector('[data-payment-page]');
    if (!page) return;
    const methods = [...page.querySelectorAll('.payment-method')];
    const panels = [...page.querySelectorAll('[data-payment-panel]')];
    const sync = value => {
      methods.forEach(label => label.classList.toggle('is-selected', label.querySelector('input')?.value === value));
      panels.forEach(panel => { panel.hidden = panel.dataset.paymentPanel !== value; });
    };
    methods.forEach(label => {
      const input = label.querySelector('input[name="paymentMethod"]');
      input?.addEventListener('change', () => sync(input.value));
    });
    const checked = page.querySelector('input[name="paymentMethod"]:checked');
    if (checked) sync(checked.value);
  }

  document.addEventListener('click', async event => {
    const copy = event.target.closest('.copy-payment');
    if (!copy) return;
    const value = copy.dataset.copy || '';
    try {
      await navigator.clipboard.writeText(value);
      const before = copy.textContent;
      copy.textContent = 'Đã chép';
      setTimeout(() => { copy.textContent = before; }, 1000);
    } catch (_) {
      copy.textContent = 'Không chép được';
    }
  });
  bindPaymentDemo();
  document.addEventListener('wave:navigation', bindPaymentDemo);
})();
