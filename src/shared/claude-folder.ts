// Her answer to "Read your Claude folder?": unasked until the consent screen, then allowed or declined.
export const FOLDER_CHOICES = ['unasked', 'allowed', 'declined'] as const;
export type FolderChoice = (typeof FOLDER_CHOICES)[number];

export const isFolderChoice = (value: unknown): value is FolderChoice => FOLDER_CHOICES.some((c) => c === value);
