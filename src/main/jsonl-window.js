// Reads a bounded slice of a jsonl file (head or tail) and parses whole lines only.
const fs = require('node:fs');

function readSlice(file, fromEnd, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const { size } = fs.fstatSync(fd);
    const length = Math.min(size, bytes);
    const start = fromEnd ? size - length : 0;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    const lines = buffer.toString('utf8').split('\n');
    if (fromEnd && start > 0) lines.shift(); // cut mid-line
    if (!fromEnd && length < size) lines.pop();
    const entries = lines.flatMap((line) => {
      try { return line ? [JSON.parse(line)] : []; } catch { return []; }
    });
    return { entries, covered: length === size };
  } catch {
    return { entries: [], covered: false };
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const readHead = (file, bytes) => readSlice(file, false, bytes);
const readTail = (file, bytes) => readSlice(file, true, bytes);

module.exports = { readHead, readTail };
