document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname;
  document.querySelectorAll('.site-header__nav a').forEach(a => {
    if (a.getAttribute('href') === path) {
      a.classList.add('nav-link--active');
    }
  });
});
