PastelTerm.reader = (() => {
  const latest = document.getElementById('latest');
  const older = document.getElementById('older');
  const status = document.getElementById('reader-status');
  const scroller = document.getElementById('reader');
  const openOlderIds = new Set();
  let latestId = null;

  const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

  function summaryText(markdownText) {
    const firstLine = markdownText.split('\n').find((line) => line.trim()) ?? '';
    const plain = firstLine.replace(/[*_`#>=]/g, '').trim();
    return plain.length > 90 ? `${plain.slice(0, 90)}…` : plain;
  }

  function olderReply(reply) {
    const details = document.createElement('details');
    details.className = 'reply older-reply';
    details.dataset.replyId = reply.id;
    details.open = openOlderIds.has(reply.id);
    details.addEventListener('toggle', () => {
      if (details.open) openOlderIds.add(reply.id); else openOlderIds.delete(reply.id);
    });
    const summary = document.createElement('summary');
    summary.textContent = `${timeOf(reply.timestamp)} · ${summaryText(reply.markdown)}`;
    const body = PastelTerm.markdown.render(reply.markdown);
    details.append(summary, body);
    PastelTerm.diagrams.render(body);
    return details;
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
    latest.replaceChildren(PastelTerm.markdown.render(newest.markdown));
    latest.dataset.replyId = newest.id;
    older.replaceChildren(...rest.map(olderReply));
    PastelTerm.diagrams.render(latest);
    if (newest.id !== latestId) scroller.scrollTop = 0; // new reply: jump to it
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
