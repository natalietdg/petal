PastelTerm.reader = (() => {
  const latest = document.getElementById('latest');
  const older = document.getElementById('older');
  const status = document.getElementById('reader-status');
  const scroller = document.getElementById('reader');
  let latestId = null;
  // The conversation reads top to bottom: earlier turns first, the newest reply last.
  status.before(older);

  const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

  const youBubble = (prompt) => Object.assign(document.createElement('div'), { className: 'reader-you', textContent: prompt });

  // An earlier turn in full: her message, then Claude's whole reply.
  function olderTurn(reply) {
    const turn = document.createElement('article');
    turn.className = 'reply older-turn';
    turn.dataset.replyId = reply.id;
    const time = Object.assign(document.createElement('p'), { className: 'older-time', textContent: timeOf(reply.timestamp) });
    const body = PastelTerm.markdown.render(reply.markdown);
    turn.append(time, ...(reply.prompt ? [youBubble(reply.prompt)] : []), body);
    PastelTerm.diagrams.render(body);
    return turn;
  }

  const column = document.querySelector('.reader-column');

  function showMessage(html) {
    status.classList.add('empty');
    status.innerHTML = html;
    latest.replaceChildren();
    older.replaceChildren();
    latestId = null;
  }

  // state: 'none' (no claude in the pty), 'live', or 'ended' (claude exited, replies kept).
  let lastUpdate = null;
  let claudeMissing = false;

  // Theme switch: rebuild so diagrams pick up the new colours.
  function rerender() {
    if (lastUpdate) update(lastUpdate);
  }

  function update({ state, replies }) {
    lastUpdate = { state, replies };
    column.classList.toggle('ended', state === 'ended');
    if (!replies.length) {
      return showMessage(state === 'live'
        ? 'Claude is running. Its replies will appear here.'
        : claudeMissing
          ? 'Claude Code isn’t installed yet. Install it, then run <code>claude</code> below.'
          : 'Run <code>claude</code> below and replies will appear here.');
    }
    const [newest, ...rest] = replies;
    status.classList.remove('empty');
    status.textContent = state === 'ended'
      ? `Session ended · last reply ${timeOf(newest.timestamp)}`
      : `Latest reply · ${timeOf(newest.timestamp)}`;
    // Chat-style: what she asked sits in a quiet bubble above Claude's reply.
    latest.replaceChildren(...(newest.prompt ? [youBubble(newest.prompt)] : []), PastelTerm.markdown.render(newest.markdown));
    latest.dataset.replyId = newest.id;
    older.replaceChildren(...[...rest].reverse().map(olderTurn)); // oldest first
    PastelTerm.diagrams.render(latest);
    if (newest.id !== latestId) status.scrollIntoView({ block: 'start' }); // new reply: bring it into view
    latestId = newest.id;
    if (view === 'flow') scheduleFlowRefresh();
  }

  let flowTimer = null;
  const scheduleFlowRefresh = () => {
    clearTimeout(flowTimer);
    flowTimer = setTimeout(refreshFlow, 1500);
  };

  // Links open in the default browser, never inside the app.
  scroller.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    event.preventDefault();
    window.pastel.openLink(link.href);
  });

  // Replies | Flow | Decisions toggle for this window's session.
  const repliesView = document.getElementById('replies-view');
  const flowView = document.getElementById('flow-view');
  const decisionsView = document.getElementById('decisions-view');
  const toggles = [...document.querySelectorAll('.view-toggle button')];
  let view = 'replies';

  async function refreshFlow() {
    const flow = await window.pastel.flow.get({ kind: 'current' });
    const container = view === 'decisions' ? decisionsView : flowView;
    const draw = view === 'decisions' ? PastelTerm.flow.renderDecisions : PastelTerm.flow.render;
    draw(container, flow, { target: { kind: 'current' }, onJump: (step) => showReply(step.replyIds) });
  }

  function setView(next) {
    view = next;
    repliesView.hidden = view !== 'replies';
    flowView.hidden = view !== 'flow';
    decisionsView.hidden = view !== 'decisions';
    for (const button of toggles) button.setAttribute('aria-selected', String(button.dataset.view === view));
    if (view !== 'replies') refreshFlow();
  }
  for (const button of toggles) button.addEventListener('click', () => setView(button.dataset.view));

  // Jump from a flow step to its reply; only the newest 20 replies are kept on screen.
  function showReply(replyIds) {
    setView('replies');
    const target = [...replyIds].reverse().map((id) => document.querySelector(`[data-reply-id="${CSS.escape(id)}"]`)).find(Boolean);
    if (!target) {
      status.textContent = 'That reply is older than the 20 kept on screen.';
      return;
    }
    if (target.tagName === 'DETAILS') target.open = true;
    target.scrollIntoView({ block: 'start' });
    target.classList.add('flash');
    setTimeout(() => target.classList.remove('flash'), 1600);
  }

  const setClaudeMissing = (missing) => { claudeMissing = missing; rerender(); };

  return { update, rerender, setView, showReply, refreshFlow, setClaudeMissing, currentView: () => view };
})();
