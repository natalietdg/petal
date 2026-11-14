// Her notes per PR (Risks, Env/config, Post-deploy checks), kept in the one notes store (notes-store.ts).
// Never in a repo, ~/.claude or any prompt Petal sends to Claude.
export { MAX_PR_FIELD_CHARS as MAX_FIELD_CHARS, readPrNotes as read, savePrNotes as save, type SaveResult } from './notes-store';
