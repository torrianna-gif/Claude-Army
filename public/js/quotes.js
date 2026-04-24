const QUOTES = [
  "questions are expected. confusion is normal. falling behind is survivable.",
  "you don't need to be an expert. you need to be willing to try.",
  "the best way to learn AI is to use AI — and then talk about it.",
  "this cohort is a lab, not a lecture.",
  "progress isn't linear. showing up is the whole job."
];

function rotateQuote() {
  const el = document.getElementById('rotating-quote');
  if (!el) return;

  let current = parseInt(el.dataset.index || '0', 10);
  current = (current + 1) % QUOTES.length;
  el.dataset.index = current;

  el.classList.add('fading');
  setTimeout(() => {
    el.textContent = QUOTES[current];
    el.classList.remove('fading');
  }, 400);
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('rotating-quote');
  if (!el) return;

  // Pick a random starting quote
  const start = Math.floor(Math.random() * QUOTES.length);
  el.dataset.index = start;
  el.textContent = QUOTES[start];

  setInterval(rotateQuote, 7000);
});
