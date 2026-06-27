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
