// Effet machine à écrire pour le terminal d'accueil.
// Respecte prefers-reduced-motion : si actif, tout le texte s'affiche directement.

(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const typedEls = document.querySelectorAll('.typed');
  const reveals = document.querySelectorAll('[data-reveal]');

  if (typedEls.length === 0) return;

  if (reduceMotion) {
    typedEls.forEach(function (el) { el.textContent = el.dataset.text; });
    reveals.forEach(function (el) { el.style.opacity = 1; });
    return;
  }

  reveals.forEach(function (el) { el.style.animationPlayState = 'paused'; });

  let i = 0;

  function typeNext() {
    if (i >= typedEls.length) return;
    const el = typedEls[i];
    const text = el.dataset.text || '';
    let charIndex = 0;

    el.classList.add('typed-cursor');

    const interval = setInterval(function () {
      el.textContent = text.slice(0, charIndex + 1);
      charIndex++;
      if (charIndex >= text.length) {
        clearInterval(interval);
        el.classList.remove('typed-cursor');
        const reveal = reveals[i];
        if (reveal) {
          reveal.style.animationPlayState = 'running';
        }
        i++;
        setTimeout(typeNext, 350);
      }
    }, 38);
  }

  typeNext();
})();
