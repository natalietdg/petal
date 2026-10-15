# Petal

A calm reader terminal for Claude Code. Replies render as pages, not scrollback.

## The idea: a reply grammar, not a parser

Petal doesn't try to parse free text out of a model. It defines the grammar on both sides:

- **Prompt side** (`prompts/`): output styles instruct Claude to answer in semantic shapes.
  The answer leads as a headline. `**Doing:** / **Recommend:** / **Next:**` status lines say
  what's running, what's advised, and the single next step. `**Decide:**` and `**Watch out:**`
  mark the two things worth a reader's interruption. `==text==` is the highlighter.
- **Render side** (`src/renderer/markdown.ts`): the renderer styles shapes, not words.
  A bold label becomes a pinned status strip or a tinted callout pill. A long-enough lede
  earns a drop cap. The same grammar lays out as a magazine feature, a research paper,
  or a pyramid brief depending on the active style.

Model output is treated as untrusted throughout: raw HTML renders as text, and everything
passes through DOMPurify on the way out.

## Styles

| Style | Shape of a reply |
|---|---|
| Magazine | Headline and dek carry the answer; lede, sections, sidebar, one pull quote |
| Research paper | Abstract first, numbered sections, limitations, references |
| Pyramid | Conclusion first, then supporting layers |
| Landing page | Scannable blocks, two to four chunks per group |

The styles live in `prompts/`. Copy them to `~/.claude/output-styles/` and pick one with
`/output-style`; Petal reads the active style at runtime and lays the session out accordingly.
