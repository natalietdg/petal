// Petal's four reply styles as the setup card offers them; files live in resources/output-styles.
// tokens: the file's size in chars/4, checked against the files by test/petal-style-choices.test.ts.
export interface PetalStyleChoice {
  name: string; // the frontmatter name, which config:use-style matches
  file: string;
  line: string;
  tokens: number;
}

export const PETAL_STYLE_CHOICES: readonly PetalStyleChoice[] = [
  { name: 'Petal · Magazine', file: 'petal-magazine.md', line: 'Headline and short summary first, then the story.', tokens: 1900 },
  { name: 'Petal · Research Paper', file: 'petal-research-paper.md', line: 'Abstract first, then numbered sections.', tokens: 1700 },
  { name: 'Petal · Pyramid', file: 'petal-pyramid.md', line: 'The answer first, then three supporting points.', tokens: 1800 },
  { name: 'Petal · Landing Page', file: 'petal-landing-page.md', line: 'Headline answer, short proof, one next step.', tokens: 2700 },
];

export const DEFAULT_PETAL_STYLE = PETAL_STYLE_CHOICES[0].name;

const PETAL_FILE = /(^|[/\\])petal-[a-z0-9-]+\.md$/;
export const isPetalStyleFile = (file: string): boolean => PETAL_FILE.test(file);

// The smallest and largest style, for copy that names the range.
export const styleTokenRange = (): { low: number; high: number } => {
  const sizes = PETAL_STYLE_CHOICES.map((s) => s.tokens);
  return { low: Math.min(...sizes), high: Math.max(...sizes) };
};
