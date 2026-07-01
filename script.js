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
