// A non-personal 1x1 PNG used only to test the Google Forms file picker.
import { writeFileSync } from 'node:fs';
const target = new URL('../tests/upload-fixture.png', import.meta.url);
writeFileSync(target, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
console.log(target.pathname);
