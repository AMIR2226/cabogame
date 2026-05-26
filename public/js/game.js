function renderYourZone() {
  const s = C.state;

  if (C.myIdx < 0) return;

  const me = s.players[C.myIdx];

  const yl = document.getElementById('your-label');

  yl.textContent =
    'YOU' +
    (s.caboCalledBy === C.myIdx ? ' ⚑' : '');

  yl.className =
    'your-label' +
    (s.currentPlayerIdx === C.myIdx ? ' is-turn' : '') +
    (s.caboCalledBy === C.myIdx ? ' cabo' : '');

  const cr = document.getElementById('your-cards');

  cr.innerHTML = '';

  for (let j = 0; j < me.cardCount; j++) {

    const isPeekCard = j < 2;

    const visible =
      (
        isPeekCard &&
        C.myCardVisible[j]
      ) ||
      s.phase === 'round-end' ||
      s.phase === 'game-over';

    const cardData = visible ? C.myCards[j] : null;

    const el = makeCard(cardData, false);

    // START PEEK
    if (
      s.phase === 'peek-start' &&
      isPeekCard &&
      !C.myCardVisible[j] &&
      me.peeksDone < 2
    ) {

      el.classList.add('clickable');

      el.addEventListener('click', () => {

        socket.emit('peek-start', { cardIdx: j }, res => {

          if (res?.error) return;

          C.myCards[j] = res.card;

          C.myCardVisible[j] = true;

          renderYourZone();

          setTimeout(() => {

            C.myCardVisible[j] = false;

            renderYourZone();

          }, 3000);
        });
      });
    }

    // REPLACE CARD
    if (
      C.drawnCard &&
      s.currentPlayerIdx === C.myIdx &&
      (
        s.phase === 'drawn' ||
        s.phase === 'playing'
      )
    ) {

      el.classList.add('highlight-replace');

      el.addEventListener('click', () => {

        socket.emit('replace-card', { cardIdx: j }, res => {

          if (res?.ok) {

            C.myCards[j] = C.drawnCard;

            C.drawnCard = null;
          }
        });
      });
    }

    // PEEK SELF
    if (
      s.phase === 'special' &&
      s.specialAction?.type === 'peek-self' &&
      s.currentPlayerIdx === C.myIdx
    ) {

      el.classList.add('highlight-swap', 'clickable');

      el.addEventListener('click', () => {

        socket.emit('special-peek-self', {
          cardIdx: j
        });
      });
    }

    // SWAP OWN
    if (
      s.phase === 'special' &&
      s.specialAction?.type === 'swap' &&
      s.specialAction?.stage === 'pick-own' &&
      s.currentPlayerIdx === C.myIdx
    ) {

      el.classList.add('highlight-replace', 'clickable');

      el.addEventListener('click', () => {

        socket.emit('special-swap-own', {
          cardIdx: j
        });
      });
    }

    cr.appendChild(el);
  }

  if (me.penaltyCount > 0) {

    const pen = makeCard(null, false);

    pen.classList.add('penalty');

    cr.appendChild(pen);
  }

  renderActions();
}
