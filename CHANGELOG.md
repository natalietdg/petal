# Changelog

Each release gets a `## [version] · date` entry here before `npm run release`; the release script checks for it.

## [1.1.1] · 2026-10-17
- Safety: the reply box no longer sends while Claude is asking for permission or a choice. Before, the Enter at the end of a message could approve the highlighted option.

## [1.1.0] · 2026-10-17
- A new setup for first-timers: pick your pet and a scene, then your pet walks you through Add Session, typing claude, and your first question.
- The setup guide offers to bring in your past Claude Code sessions, and can build your Library from them.
- History no longer drops sessions made only of very long lines, like pasted images or big tool output.
- New users no longer get stuck: Claude's setup screens have room, Petal finds Claude Code even when your shell's PATH doesn't, and it says plainly when Claude Code isn't installed yet.
- Works with older Claude Code too: replies show and "conclude" closes the tab on versions back to 2.1.74.
- A first reply that Claude Code saves before your question no longer goes missing.
- Distillation in the test loop: each round Claude questions its own work from the evidence, picks a course (add scenarios, retest, fix the bug, or hand to you) and acts on it.
- Questions Claude can't settle become Open threads, revisited every round, and anything only you can answer shows as a "Claude needs you" card.
- Suite health in Testing: flaky tests, tests that never fail, the slowest ones, and a fast Core stage to run first.
- Lessons from sessions: your corrections become short rules you can add to CLAUDE.md after a preview. Turn it on in Customize › Organizer.
- Background work like the Library and lessons can run on a cheaper model, with a count of calls made today.

## [1.0.9] · 2026-10-16
- Text size: make the terminal and the reader bigger or smaller with ⌘= and ⌘-, ⌘0 to reset, or set each one in Customize.
- Works with older Claude Code versions, and the reader suggests updating when yours is out of date.
- Concluded sessions get a "This session" line under the conclusion: its Library notes, test runs and test loop.
- Message another open session with @ in the reply box, from the Board's Message…, or from a reply's To line.
- Tasks on the Board: give each project task to one session, and see who is working on what.
- A warning when two sessions edit the same file.
- The Board's Activity feed lists tasks, edits, test runs, conclusions, Library notes, clashes and messages, with a branch filter.
- Images a reply names on your Mac show inline in the reply.
- Say "conclude" in any session once the Petal skills are installed, and it wraps up into Petal's banner.
- Testing history says what ran, why and what changed; a tab in your home folder picks a project, Claude's runs are filed by repo, and "Make a pipeline from these commands" turns them into your pipeline.

## [1.0.8] · 2026-10-16
- New to Claude Code? The terminal now makes room for its first-run setup, the reader says what to do, and the theme and login choices show as cards you can click.
- Petal finds Claude Code even when its install folder isn't on your shell's PATH, so Add Session no longer says "command not found".

## [1.0.7] · 2026-10-16
- Up to 20 open sessions by default (was 8); change it under Customize › Sessions.
- Factory starts with stations that fit any project, and the approval step is yours: "You approve".
- During a factory run, a Station bar in the top strip shows which step Claude is on and whether it has passed.
- Updates are easier to spot: the pill names the version, a Mac notification says when one is ready, Petal › Check for Updates… checks on demand, and a "What's new" note follows each update.
- Petal's reply styles now cover Steps and Conclude.
- Library: a half dial of domain knowledge Claude gathers from your sessions, colour-coded by category. Add to Library from any session, read past sessions, and tidy duplicates by merging, renaming or deleting notes. Turn it on in Customize › Organizer.
- Testing tab: your project's test pipeline in one click, results grouped by file, Ask Claude to fix, and a pass-rate history.
- Test loop: Claude writes test scenarios, turns each bug it finds into a test, fixes it and runs again. Stop it any time; it never commits.
- Say "testing suite" or "library" in any session once the Petal skills are installed (Customize › Formatting).
- Type / in the reply box for every skill, command and agent you have.
- Claude Code's own menus, like /model, show as cards you can pick from in the reader.
- A Stop button stops Claude mid-reply, from the reply box, the reply or the Board (⌘.).
- Replies can end with Open threads: question cards you click to ask next.
- Concluding a session also closes its tab.

## [1.0.6] · 2026-10-14
- Icons on the top bar buttons.
- Fold the Doing / Recommend / Next strip and the conclusion into one slim bar; Petal remembers it.
- Focus (⌘⇧F) shows only the reply, full window.
- Minimise the top bar (⌘⇧H) or the terminal (⌘R) to thin strips.
- Workflow › Factory: set the stations Claude follows, from intake to ship.
- A Shortcuts guide (⌘/) lists every key, word and gesture.

## [1.0.5] · 2026-10-13
- The Sessions board shows every open session: your pet no longer covers the bottom cards, and a session open twice shows once.
- A small Board button sits beside History.
- A concluded session keeps a one-line summary pinned at the top; the full conclusion sits at the bottom.
- Saying "conclude" closes the session once its summary is saved.

## [1.0.4] · 2026-10-13
- Your pet sits in the History preview's reply row while you browse.

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
