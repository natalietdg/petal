// A step that records Activity puts the feed back as it found it, so a later step's checks see only their own events.
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { flush, resetForTests } from '../main/activity-feed';

export function keepActivity(): () => void {
  const file = path.join(app.getPath('userData'), 'activity.json');
  flush();
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  return () => {
    resetForTests(); // drops the pending save, so the restored file is what the next read sees
    if (before === null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, before);
  };
}
