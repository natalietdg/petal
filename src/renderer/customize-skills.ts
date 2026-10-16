// Customize › Formatting › Petal skills: the skills Petal ships for Claude Code, each skill's status, and Install/Update.
import { el, isIpcError } from './dom';
import { actionButton, card, note, page } from './customize-kit';
import type { PetalSkill, PetalSkills } from '../main/petal-skills';
import type { PetalStyleState } from '../main/petal-styles';

// The phrase that starts each skill in a Claude session.
const PHRASES: Record<string, string> = { 'petal-testing-suite': 'testing suite', 'petal-library': 'library', 'petal-conclude': 'conclude' };

const BADGES: Record<PetalStyleState, { text: string; className: string }> = {
  missing: { text: 'Not installed', className: 'cz-skill-missing' },
  current: { text: 'Installed', className: 'cz-ok' },
  outdated: { text: 'Update ready', className: 'cz-skill-outdated' },
  edited: { text: 'Edited', className: 'cz-fail' },
  foreign: { text: 'Your own file', className: 'cz-fail' },
};

// The line after an install, kept only while the page shows the state it was made against.
let installed: { line: string; state: typeof page.state } | null = null;

// One line per skill Petal left alone, so a skipped update is never silent.
export function petalSkillNotes({ skills }: PetalSkills): string[] {
  return skills.flatMap((s) => {
    if (s.state === 'edited') return [`${s.name}: edited since Petal wrote it, so it was not updated.`];
    if (s.state === 'foreign') return [`${s.name}: a skill of yours has this name, so Petal left it alone.`];
    return [];
  });
}

async function install(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  const result = await window.pastel.config.addPetalSkills();
  const fresh = await window.pastel.config.get();
  if (!isIpcError(fresh)) page.state = fresh;
  installed = { line: isIpcError(result) ? `Couldn’t install them: ${result.error}` : 'Installed. New Claude sessions pick them up.', state: page.state };
  page.redraw();
}

function skillRow(skill: PetalSkill): HTMLDivElement {
  const row = el('div', 'cz-skill');
  row.dataset.skill = skill.dir;
  const badge = BADGES[skill.state];
  const name = el('span', 'cz-style-name', PHRASES[skill.dir] ? `“${PHRASES[skill.dir]}”` : skill.name);
  name.append(el('span', `cz-badge ${badge.className} cz-skill-state`, badge.text));
  row.append(name, el('span', 'cz-style-desc', `${skill.summary} Also /${skill.name}.`));
  return row;
}

export function petalSkillsCard(): HTMLDivElement {
  const { petalSkills } = page.state;
  const children: Node[] = [note('Say these words in any Claude session, in Petal or not, and Claude picks the skill up.')];
  if (petalSkills.skills.length) {
    const list = el('div', 'cz-skills');
    list.append(...petalSkills.skills.map(skillRow));
    children.push(list);
  } else {
    children.push(el('p', 'cz-empty', 'Allow Petal to read your Claude folder under Get started to install these.'));
  }
  if (petalSkills.installable) {
    const anyMissing = petalSkills.skills.some((s) => s.state === 'missing');
    const button: HTMLButtonElement = actionButton(anyMissing ? 'Install' : 'Update', () => install(button), 'flow-button cz-skills-install');
    const row = el('div', 'cz-actions cz-petal-offer');
    row.append(button, el('span', 'cz-status', 'Copies them into ~/.claude/skills. Nothing else changes.'));
    children.push(row);
  }
  children.push(...petalSkillNotes(petalSkills).map((line) => note(line, 'cz-note cz-skill-note')));
  if (installed?.state === page.state) children.push(note(installed.line, 'cz-note cz-skills-installed'));
  return card('Petal skills', ...children);
}
