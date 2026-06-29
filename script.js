const menuToggle = document.querySelector('.menu-toggle');
const siteNav = document.querySelector('.site-nav');

if (menuToggle && siteNav) {
  menuToggle.addEventListener('click', () => {
    const isOpen = siteNav.dataset.open === 'true';
    siteNav.dataset.open = String(!isOpen);
    menuToggle.setAttribute('aria-expanded', String(!isOpen));
  });

  siteNav.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      siteNav.dataset.open = 'false';
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 680) {
      siteNav.dataset.open = 'false';
      menuToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

const artWarning = document.querySelector('#art-warning');
const warningClose = document.querySelector('.warning-close');

if (artWarning) {
  if (typeof artWarning.showModal === 'function') {
    artWarning.showModal();
  } else {
    artWarning.setAttribute('open', '');
  }

  warningClose?.addEventListener('click', () => {
    if (typeof artWarning.close === 'function') {
      artWarning.close();
    } else {
      artWarning.removeAttribute('open');
    }
  });

  artWarning.addEventListener('click', (event) => {
    if (event.target === artWarning && typeof artWarning.close === 'function') {
      artWarning.close();
    }
  });
}

// Shared chapter reactions and comments are loaded from the site database.
const feedbackSections = document.querySelectorAll('.chapter-feedback[data-chapter]');

const getVisitorId = () => {
  const storageKey = 'gcsg:visitor-id';
  let visitorId = localStorage.getItem(storageKey);
  if (!visitorId) {
    visitorId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `visitor_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(storageKey, visitorId);
  }
  return visitorId;
};

const visitorId = getVisitorId();

const parseApiResponse = async (response) => {
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data.error || 'The shared feedback service is unavailable.');
  }
  return data;
};

feedbackSections.forEach((feedback) => {
  const chapterId = feedback.dataset.chapter;
  const reactionButtons = [...feedback.querySelectorAll('.reaction-button[data-reaction]')];
  const form = feedback.querySelector('.comment-form');
  const list = feedback.querySelector('.comment-list');
  let currentReaction = '';

  const status = document.createElement('p');
  status.className = 'feedback-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  feedback.prepend(status);

  const setStatus = (message, state = '') => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const setBusy = (busy) => {
    feedback.setAttribute('aria-busy', String(busy));
    reactionButtons.forEach((button) => {
      button.disabled = busy;
    });
    if (form) {
      [...form.elements].forEach((control) => {
        control.disabled = busy;
      });
    }
  };

  const renderReactionState = (data) => {
    currentReaction = data.visitorReaction || '';
    reactionButtons.forEach((button) => {
      const reaction = button.dataset.reaction;
      button.setAttribute('aria-pressed', String(reaction === currentReaction));
      const counter = button.querySelector('.reaction-count');
      if (counter) {
        counter.textContent = String(data.counts?.[reaction] ?? 0);
      }
    });
  };

  const renderComments = (comments = []) => {
    if (!list) return;
    list.replaceChildren();

    if (!comments.length) {
      const empty = document.createElement('p');
      empty.className = 'comment-empty';
      empty.textContent = 'No comments yet.';
      list.append(empty);
      return;
    }

    comments.forEach((comment) => {
      const article = document.createElement('article');
      article.className = 'reader-comment';

      const header = document.createElement('div');
      header.className = 'reader-comment-header';

      const name = document.createElement('span');
      name.className = 'reader-comment-name';
      name.textContent = comment.name || 'Anonymous';

      const time = document.createElement('time');
      time.className = 'reader-comment-time';
      time.dateTime = comment.created_at;
      time.textContent = new Date(comment.created_at).toLocaleString();

      const body = document.createElement('p');
      body.className = 'reader-comment-body';
      body.textContent = comment.body;

      header.append(name, time);
      article.append(header, body);
      list.append(article);
    });
  };

  const loadFeedback = async () => {
    if (window.location.protocol === 'file:') {
      setStatus('Start the website with server.py to use shared likes and comments.', 'error');
      return;
    }

    setBusy(true);
    setStatus('Loading shared feedback…', 'loading');
    try {
      const response = await fetch(
        `/api/chapters/${encodeURIComponent(chapterId)}/feedback?visitor_id=${encodeURIComponent(visitorId)}`,
        { headers: { Accept: 'application/json' } }
      );
      const data = await parseApiResponse(response);
      renderReactionState(data);
      renderComments(data.comments);
      setStatus('');
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  reactionButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const selected = button.dataset.reaction;
      const nextReaction = currentReaction === selected ? '' : selected;
      setBusy(true);
      setStatus('Saving reaction…', 'loading');

      try {
        const response = await fetch(
          `/api/chapters/${encodeURIComponent(chapterId)}/reaction`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json'
            },
            body: JSON.stringify({ visitorId, reaction: nextReaction })
          }
        );
        const data = await parseApiResponse(response);
        renderReactionState(data);
        renderComments(data.comments);
        setStatus('');
      } catch (error) {
        setStatus(error.message, 'error');
      } finally {
        setBusy(false);
      }
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const name = String(formData.get('name') || '').trim();
    const comment = String(formData.get('comment') || '').trim();
    if (!comment) return;

    setBusy(true);
    setStatus('Posting comment…', 'loading');

    try {
      const response = await fetch(
        `/api/chapters/${encodeURIComponent(chapterId)}/comments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({ visitorId, name, comment })
        }
      );
      await parseApiResponse(response);
      form.reset();
      await loadFeedback();
    } catch (error) {
      setStatus(error.message, 'error');
      setBusy(false);
    }
  });

  loadFeedback();
});

// Sticky chapter rail for character reading pages.
const chapterRail = document.querySelector('.chapter-rail');
const chapterRailToggle = document.querySelector('.chapter-rail-toggle');
const chapterRailLinks = [...document.querySelectorAll('.chapter-rail-nav a[href^="#"]')];
const chapterSections = chapterRailLinks
  .map((link) => document.querySelector(link.getAttribute('href')))
  .filter(Boolean);

if (chapterRail && chapterRailToggle) {
  const closeRail = () => {
    chapterRail.dataset.open = 'false';
    chapterRailToggle.setAttribute('aria-expanded', 'false');
  };

  chapterRailToggle.addEventListener('click', () => {
    const isOpen = chapterRail.dataset.open === 'true';
    chapterRail.dataset.open = String(!isOpen);
    chapterRailToggle.setAttribute('aria-expanded', String(!isOpen));
  });

  chapterRailLinks.forEach((link) => {
    link.addEventListener('click', () => {
      if (window.innerWidth <= 1150) closeRail();
    });
  });

  document.addEventListener('click', (event) => {
    if (
      window.innerWidth <= 1150 &&
      chapterRail.dataset.open === 'true' &&
      !chapterRail.contains(event.target)
    ) {
      closeRail();
    }
  });

  window.addEventListener('resize', () => {
    if (window.innerWidth > 1150) closeRail();
  });
}

if (chapterSections.length && 'IntersectionObserver' in window) {
  const setActiveChapter = (id) => {
    chapterRailLinks.forEach((link) => {
      const isActive = link.getAttribute('href') === `#${id}`;
      if (isActive) {
        link.setAttribute('aria-current', 'true');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  };

  const visibleSections = new Map();
  const chapterObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        visibleSections.set(entry.target.id, entry.boundingClientRect.top);
      } else {
        visibleSections.delete(entry.target.id);
      }
    });

    if (visibleSections.size) {
      const active = [...visibleSections.entries()]
        .sort((a, b) => Math.abs(a[1] - 120) - Math.abs(b[1] - 120))[0][0];
      setActiveChapter(active);
    }
  }, {
    rootMargin: '-90px 0px -65% 0px',
    threshold: [0, 0.01]
  });

  chapterSections.forEach((section) => chapterObserver.observe(section));
}
