# Changelog

Each release gets a `## [version] · date` entry here before `npm run release`; the release script checks for it.

## [1.0.3] · 2026-10-13
- The "Read your Claude folder?" question stays up until you answer it.
- History explains when it's empty because folder reading is off, with an Allow button.
- Replies no longer hide: answers after an agent's message, later answers under a folded section, and summaries shown as your message are fixed.
- Pasted images show as thumbnails in your message bubbles.
- Sessions board: every open session at a glance (Sessions › Board, or ⌘⇧O).
- Wide tables, code or long names no longer push the cat, header and Sessions list off the window.

## [1.0.2] · 2026-10-13
- Add Session starts Claude in the new tab.
- First launch asks before reading your Claude folder; change it any time in Customize.
- A Get started checklist walks new users from install to their first reply.

## [1.0.1] · 2026-10-12

- Removes developer test code from the app bundle.

## [1.0.0] · unreleased

The first public Petal: a calm, readable terminal for Claude Code.

- **A terminal and a reader, side by side.** The terminal runs your shell and Claude as usual. Above it, the reader shows Claude's replies as a page you can actually read, in newspaper, magazine or print styles. ⌘R switches between reader only and split.
- **Tabs and sessions.** ⌘T opens a tab, Add Session starts one from the dock. The Sessions pill shows how many are busy and open, and offers to close the oldest idle one when you pass your limit.
- **Answering Claude without the terminal.** When Claude asks a question or shows a picker, the choices appear under the reader as buttons. The reply box sends a message to the active tab.
- **Flow and Decisions.** Each session gets a short plain-words outline of what happened and what was decided, exportable as a Mermaid diagram.
- **History (⌘Y).** Every past Claude session, taggable, with a preview. Open one in a new tab or send it to the current one.
- **Workflow.** Today's sessions, time spent, setup and handoffs, in one place.
- **Open Repo (⌘O).** Jump to any repo on your machine; Petal types the `cd` for you, or opens a new tab when Claude is busy in this one.
- **Pasting files and images.** Paste or drop a screenshot and Claude gets the file.
- **Make it yours.** Pastel themes in light and dark, a pet that keeps you company, and calm animated scenes, from a lantern-lit izakaya to a planetarium and a tarot room.
- **Quiet updates.** Petal checks for updates in the background and shows "Update ready · Restart" when one has downloaded. It never restarts while Claude is running in a tab.
