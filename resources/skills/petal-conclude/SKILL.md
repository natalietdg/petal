---
name: petal-conclude
description: Wrap up the whole session in a short Conclusion, Result and Impact block that Petal pins as a banner and then closes the session. Use when the user's message is "conclude" or starts with "conclude", or runs /petal-conclude.
---

# Conclude

The user is done with this session. Reply with this block and nothing else, covering the whole session, not just the last turn:

**Conclusion:** one or two sentences on what was settled.
**Result:** what exists or changed now, concretely (files, merges, installs, decisions).
**Impact:** what it means for the user or the project, and anything still open.

## Rules

- Keep each line to one or two sentences. Name real files, commands and decisions; no filler.
- Say plainly what is unfinished or unverified in Impact. Never claim something works unless it was checked in this session.
- Don't list Library notes or test runs: Petal adds the session's Library and test results under the conclusion itself.
- Don't start new work, ask questions or offer next steps beyond the block. Petal closes the session once this reply is in.
- If the message is "conclude" followed by more words (for example "conclude: banners"), still reply with the block; use the extra words as the focus of Conclusion.
